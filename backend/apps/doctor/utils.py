from collections import defaultdict
from datetime import timedelta, time

from django.db import transaction
from django.db.models import Exists, OuterRef
from django.utils import timezone

from .models import Consultation, DoctorRegistration, DoctorSlot


WEEKDAY_NAMES = [
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
]

WEEKDAY_ALIASES = {
    'mon': 'monday',
    'monday': 'monday',
    'tue': 'tuesday',
    'tues': 'tuesday',
    'tuesday': 'tuesday',
    'wed': 'wednesday',
    'wednesday': 'wednesday',
    'thu': 'thursday',
    'thur': 'thursday',
    'thurs': 'thursday',
    'thursday': 'thursday',
    'fri': 'friday',
    'friday': 'friday',
    'sat': 'saturday',
    'saturday': 'saturday',
    'sun': 'sunday',
    'sunday': 'sunday',
}

AUTO_OBSOLETE_BLOCK_REASONS = {
    'Schedule updated',
    'Schedule deactivated',
}


def is_auto_obsolete_block(slot):
    return (
        (slot.is_blocked or slot.status == 'blocked')
        and (slot.block_reason or '') in AUTO_OBSOLETE_BLOCK_REASONS
    )


def normalize_working_days(days):
    if not isinstance(days, list) or not days:
        raise ValueError('Working days cannot be empty.')

    normalized = set()
    for raw_day in days:
        day = str(raw_day).strip().lower()
        if day.isdigit():
            index = int(day)
            if 0 <= index <= 6:
                normalized.add(WEEKDAY_NAMES[index])
                continue
        if day in WEEKDAY_ALIASES:
            normalized.add(WEEKDAY_ALIASES[day])
            continue
        raise ValueError(f'Invalid working day: {raw_day}')

    return [day for day in WEEKDAY_NAMES if day in normalized]


def _minutes(value):
    return value.hour * 60 + value.minute


def _time_from_minutes(value):
    return time(value // 60, value % 60)


def _delete_obsolete_slots(schedule, expected_keys, start_date):
    available_slots = schedule.slots.select_for_update().filter(
        slot_date__gte=start_date,
        is_booked=False,
        status='available',
        is_blocked=False,
    ).filter(~Exists(Consultation.objects.filter(slot_id=OuterRef('pk'))))
    obsolete_ids = [
        slot_id
        for slot_id, slot_date, start, end in available_slots.values_list(
            'pk', 'slot_date', 'start_time', 'end_time',
        )
        if (slot_date, start, end) not in expected_keys
    ]
    deleted = 0
    for offset in range(0, len(obsolete_ids), 500):
        _, counts = schedule.slots.filter(pk__in=obsolete_ids[offset:offset + 500]).delete()
        deleted += counts.get(DoctorSlot._meta.label, 0)
    return deleted


def get_current_schedule_for_doctor(doctor):
    """Return the single current active schedule used for booking/listing."""
    from .models import DoctorSchedule

    return (
        DoctorSchedule.objects
        .filter(
            doctor=doctor,
            hospital=doctor.hospital_id,
            is_active=True,
        )
        .order_by('-updated_at', '-created_at')
        .first()
    )


def deactivate_duplicate_schedules(primary_schedule, days_ahead=30):
    """Deactivate older active schedules for the same doctor without deleting history."""
    from .models import DoctorSchedule

    days_ahead = max(1, min(int(days_ahead or 30), 180))
    duplicates = DoctorSchedule.objects.filter(
        hospital=primary_schedule.hospital,
        doctor=primary_schedule.doctor,
        is_active=True,
    ).exclude(schedule_id=primary_schedule.schedule_id)

    deactivated = 0
    blocked = 0
    for schedule in duplicates:
        schedule.is_active = False
        schedule.save(update_fields=['is_active', 'updated_at'])
        result = generate_slots_for_schedule(
            schedule,
            days_ahead=days_ahead,
            prune_available=True,
        )
        deactivated += 1
        blocked += result.get('blocked', 0)

    return {'deactivated': deactivated, 'blocked': blocked}


def release_expired_consultation_holds(now=None):
    """Cancel unpaid consultation holds after their reservation window expires."""
    now = now or timezone.now()
    expired = (
        Consultation.objects
        .select_related('slot_id')
        .filter(
            status='scheduled',
            payment_status='pending',
            payment_hold_expires_at__isnull=False,
            payment_hold_expires_at__lte=now,
        )
    )

    released = 0
    for consultation in expired:
        slot = consultation.slot_id
        consultation.status = 'cancelled'
        consultation.payment_status = 'failed'
        consultation.save(update_fields=['status', 'payment_status'])

        if slot and slot.is_booked:
            has_confirmed_booking = Consultation.objects.filter(
                slot_id=slot,
                payment_status='paid',
            ).exclude(consultation_id=consultation.consultation_id).exclude(
                status='cancelled',
            ).exists()
            has_active_hold = Consultation.objects.filter(
                slot_id=slot,
                status='scheduled',
                payment_status='pending',
                payment_hold_expires_at__gt=now,
            ).exclude(consultation_id=consultation.consultation_id).exists()

            if not has_confirmed_booking and not has_active_hold:
                slot.is_booked = False
                if not slot.is_blocked:
                    slot.status = 'available'
                slot.save(update_fields=['is_booked', 'status', 'updated_at'])
        released += 1

    return released


@transaction.atomic
def generate_slots_for_schedule(schedule, days_ahead=30, start_date=None, prune_available=False):
    """Generate future DoctorSlot rows for a hospital-created schedule.

    Duplicate protection is based on doctor + date + start + end, matching the
    requested workflow while preserving old booked slots.
    """
    doctor = DoctorRegistration.objects.select_for_update(no_key=True).get(pk=schedule.doctor_id)
    try:
        schedule.refresh_from_db()
    except schedule.DoesNotExist:
        return {'created': 0, 'updated': 0, 'preserved_booked': 0, 'blocked': 0}
    days = normalize_working_days(schedule.working_days)
    schedule.working_days = days

    days_ahead = max(1, min(int(days_ahead or 30), 180))
    start_date = start_date or timezone.localdate()
    now = timezone.localtime(timezone.now())

    if schedule.end_time <= schedule.start_time:
        raise ValueError('End time must be greater than start time.')
    if schedule.slot_duration_minutes <= 0:
        raise ValueError('Slot duration must be positive.')
    if schedule.consultation_fee < 0:
        raise ValueError('Consultation fee must be zero or greater.')
    if doctor.hospital_id_id != schedule.hospital_id:
        raise ValueError('Doctor must belong to the selected hospital.')

    expected_keys = set()
    new_slots = []
    changed_slots = defaultdict(list)
    updated = 0
    preserved_booked = 0

    if not schedule.is_active:
        blocked = _delete_obsolete_slots(schedule, expected_keys, start_date)
        return {'created': 0, 'updated': 0, 'preserved_booked': 0, 'blocked': blocked}

    start_min = _minutes(schedule.start_time)
    end_min = _minutes(schedule.end_time)
    duration = int(schedule.slot_duration_minutes)

    existing_slots = {}
    for slot in DoctorSlot.objects.select_for_update().filter(
        doctor_id=schedule.doctor_id,
        slot_date__range=(start_date, start_date + timedelta(days=days_ahead - 1)),
    ).order_by('created_at', 'pk'):
        existing_slots.setdefault((slot.slot_date, slot.start_time, slot.end_time), slot)

    for offset in range(days_ahead):
        slot_date = start_date + timedelta(days=offset)
        weekday = WEEKDAY_NAMES[slot_date.weekday()]
        if weekday not in days:
            continue

        cursor = start_min
        while cursor + duration <= end_min:
            slot_start = _time_from_minutes(cursor)
            slot_end = _time_from_minutes(cursor + duration)
            cursor += duration

            if slot_date == now.date() and slot_start <= now.time():
                continue

            key = (slot_date, slot_start, slot_end)
            expected_keys.add(key)
            slot = existing_slots.get(key)

            if slot:
                values = {}
                if not slot.hospital_id:
                    values['hospital_id'] = schedule.hospital_id
                if not slot.schedule_id:
                    values['schedule_id'] = schedule.pk
                if slot.is_booked or slot.status == 'booked':
                    values['status'] = 'booked'
                    preserved_booked += 1
                else:
                    values.update(
                        hospital_id=schedule.hospital_id,
                        schedule_id=schedule.pk,
                        consult_type=schedule.consultation_type,
                        consultation_fee=schedule.consultation_fee,
                    )
                    if not (slot.is_blocked or slot.status == 'blocked') or is_auto_obsolete_block(slot):
                        values.update(status='available', is_blocked=False, blocked_by=None, block_reason='')

                update_fields = []
                for field, value in values.items():
                    if getattr(slot, field) != value:
                        setattr(slot, field, value)
                        update_fields.append(field)
                if update_fields:
                    slot.updated_at = now
                    changed_slots[tuple(update_fields) + ('updated_at',)].append(slot)
                    updated += int(slot.status == 'available' and not slot.is_blocked)
                continue

            new_slots.append(DoctorSlot(
                doctor_id_id=schedule.doctor_id,
                hospital_id=schedule.hospital_id,
                schedule_id=schedule.pk,
                slot_date=slot_date,
                start_time=slot_start,
                end_time=slot_end,
                consult_type=schedule.consultation_type,
                consultation_fee=schedule.consultation_fee,
                status='available',
                is_booked=False,
            ))

    DoctorSlot.objects.bulk_create(new_slots, batch_size=500)
    for fields, batch in changed_slots.items():
        DoctorSlot.objects.bulk_update(batch, fields, batch_size=250)

    blocked = 0
    if prune_available:
        blocked = _delete_obsolete_slots(schedule, expected_keys, start_date)

    return {
        'created': len(new_slots),
        'updated': updated,
        'preserved_booked': preserved_booked,
        'blocked': blocked,
    }


def block_doctor_slot(slot, blocked_by, reason=''):
    if slot.is_booked or slot.status == 'booked':
        raise ValueError('Booked slots cannot be blocked')
    if slot.is_blocked or slot.status == 'blocked':
        raise ValueError('Only available slots can be blocked')
    if slot.status != 'available':
        raise ValueError('Only available slots can be blocked')

    slot.status = 'blocked'
    slot.is_blocked = True
    slot.blocked_by = blocked_by
    slot.block_reason = reason or 'Unavailable'
    slot.save(update_fields=['status', 'is_blocked', 'blocked_by', 'block_reason', 'updated_at'])
    return slot
