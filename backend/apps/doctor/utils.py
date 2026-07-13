from datetime import timedelta, time

from django.utils import timezone

from .models import DoctorSlot


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


def _mark_obsolete_slots(schedule, expected_keys, start_date, reason):
    blocked = 0
    qs = schedule.slots.filter(
        slot_date__gte=start_date,
        is_booked=False,
        status='available',
        is_blocked=False,
    )
    for slot in qs:
        key = (slot.slot_date, slot.start_time, slot.end_time)
        if key in expected_keys:
            continue
        slot.delete()
        blocked += 1
    return blocked


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
    from .models import Consultation

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


def generate_slots_for_schedule(schedule, days_ahead=30, start_date=None, prune_available=False):
    """Generate future DoctorSlot rows for a hospital-created schedule.

    Duplicate protection is based on doctor + date + start + end, matching the
    requested workflow while preserving old booked slots.
    """
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
    if schedule.doctor.hospital_id_id != schedule.hospital_id:
        raise ValueError('Doctor must belong to the selected hospital.')

    expected_keys = set()
    created = 0
    updated = 0
    preserved_booked = 0

    if not schedule.is_active:
        blocked = _mark_obsolete_slots(
            schedule,
            expected_keys,
            start_date,
            'Schedule deactivated',
        )
        return {'created': 0, 'updated': 0, 'preserved_booked': 0, 'blocked': blocked}

    start_min = _minutes(schedule.start_time)
    end_min = _minutes(schedule.end_time)
    duration = int(schedule.slot_duration_minutes)

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

            expected_keys.add((slot_date, slot_start, slot_end))
            slot = DoctorSlot.objects.filter(
                doctor_id=schedule.doctor,
                slot_date=slot_date,
                start_time=slot_start,
                end_time=slot_end,
            ).order_by('created_at').first()

            if slot:
                update_fields = []
                if not slot.hospital_id:
                    slot.hospital = schedule.hospital
                    update_fields.append('hospital')
                if not slot.schedule_id:
                    slot.schedule = schedule
                    update_fields.append('schedule')
                if slot.is_booked or slot.status == 'booked':
                    if slot.status != 'booked':
                        slot.status = 'booked'
                        update_fields.append('status')
                    preserved_booked += 1
                elif slot.is_blocked or slot.status == 'blocked':
                    slot.hospital = schedule.hospital
                    slot.schedule = schedule
                    slot.consult_type = schedule.consultation_type
                    slot.consultation_fee = schedule.consultation_fee
                    update_fields.extend(['hospital', 'schedule', 'consult_type', 'consultation_fee'])
                    if is_auto_obsolete_block(slot):
                        slot.status = 'available'
                        slot.is_blocked = False
                        slot.blocked_by = None
                        slot.block_reason = ''
                        update_fields.extend([
                            'status',
                            'is_blocked',
                            'blocked_by',
                            'block_reason',
                        ])
                        updated += 1
                else:
                    slot.hospital = schedule.hospital
                    slot.schedule = schedule
                    slot.consult_type = schedule.consultation_type
                    slot.consultation_fee = schedule.consultation_fee
                    slot.status = 'available'
                    slot.is_blocked = False
                    slot.blocked_by = None
                    slot.block_reason = ''
                    update_fields.extend([
                        'hospital',
                        'schedule',
                        'consult_type',
                        'consultation_fee',
                        'status',
                        'is_blocked',
                        'blocked_by',
                        'block_reason',
                    ])
                    updated += 1
                if update_fields:
                    update_fields.append('updated_at')
                    slot.save(update_fields=list(dict.fromkeys(update_fields)))
                continue

            DoctorSlot.objects.create(
                doctor_id=schedule.doctor,
                hospital=schedule.hospital,
                schedule=schedule,
                slot_date=slot_date,
                start_time=slot_start,
                end_time=slot_end,
                consult_type=schedule.consultation_type,
                consultation_fee=schedule.consultation_fee,
                status='available',
                is_booked=False,
            )
            created += 1

    blocked = 0
    if prune_available:
        blocked = _mark_obsolete_slots(
            schedule,
            expected_keys,
            start_date,
            'Schedule updated',
        )

    return {
        'created': created,
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
