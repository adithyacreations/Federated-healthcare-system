"""Lab slot helpers — auto-generation and 12-hour time formatting."""
from datetime import date, timedelta, datetime, time


def fmt_12hr(t):
    """Format a datetime.time as Indian 12-hour text, e.g. '8:30 AM'.

    Implemented manually because the `%-I` strftime directive is not portable
    (it fails on Windows).
    """
    if t is None:
        return ''
    hour = t.hour % 12 or 12
    period = 'AM' if t.hour < 12 else 'PM'
    return f"{hour}:{t.minute:02d} {period}"


def _test_label(order):
    """Human-readable test name(s) from a LabTestOrder's `tests` JSON list."""
    names = [
        (t.get('name') if isinstance(t, dict) else str(t))
        for t in (order.tests or [])
    ]
    return ', '.join(n for n in names if n) or 'Lab Test'


def detect_and_mark_no_shows():
    """Mark paid+confirmed lab bookings whose slot ended 30+ minutes ago (and
    that the patient never showed up for) as 'no_show', free the held slot seat,
    and notify the patient. Returns the number of orders marked.

    Shared by the `detect_no_shows` management command (cron) and the on-read
    sweep in the lab-tech orders list, so no background thread is required.
    """
    from django.utils import timezone
    from apps.patient.models import LabTestOrder

    now = timezone.localtime(timezone.now())
    today = now.date()
    cutoff = (now - timedelta(minutes=30)).time()

    candidates = (
        LabTestOrder.objects
        .filter(
            status='confirmed', payment_status='paid',
            slot_id__slot_date=today, slot_id__end_time__lte=cutoff,
        )
        .select_related('patient_id', 'slot_id', 'patient_id__login_id')
    )

    from utils import send_notification, db_save_with_retry  # local import avoids load-time cycles

    marked = 0
    for order in list(candidates):
        try:
            test_name = _test_label(order)
            order.status = 'no_show'
            order.no_show_at = now
            order.no_show_marked_by = 'auto'
            db_save_with_retry(order, update_fields=['status', 'no_show_at', 'no_show_marked_by'])

            slot = order.slot_id
            if slot:
                slot.booked_count = max(0, slot.booked_count - 1)
                db_save_with_retry(slot, update_fields=['booked_count'])

            send_notification(
                order.patient_id.login_id,
                '😔 Missed Lab Appointment',
                f'You missed your {test_name} appointment. '
                'Please rebook if you still need the test.',
                notif_type='lab',
            )
            _maybe_warn_repeat_no_shows(order.patient_id, now)
            marked += 1
        except Exception as e:  # noqa: BLE001
            print(f'[no-show] error for {order.order_id}: {e}')
    return marked


def monthly_no_show_count(patient, now=None):
    """How many lab appointments this patient has no-showed this calendar month."""
    from django.utils import timezone
    from apps.patient.models import LabTestOrder
    now = now or timezone.localtime(timezone.now())
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return LabTestOrder.objects.filter(
        patient_id=patient, status='no_show', no_show_at__gte=month_start,
    ).count()


def _maybe_warn_repeat_no_shows(patient, now):
    """Send an in-app warning once a patient hits 3+ no-shows in the month."""
    try:
        count = monthly_no_show_count(patient, now)
        if count >= 3:
            from utils import send_notification
            send_notification(
                patient.login_id,
                '⚠️ Multiple Missed Appointments',
                f'You have missed {count} lab appointments this month. '
                'Please ensure you attend your booked tests or cancel in advance.',
                notif_type='lab',
            )
    except Exception as e:  # noqa: BLE001
        print(f'[no-show] repeat-warning error: {e}')


def generate_lab_slots(hospital, days_ahead=30):
    """Create LabSlot rows for the hospital's working days within `days_ahead`.

    Idempotent — uses get_or_create so re-running only fills gaps. Creates a
    sensible default HospitalLabConfig the first time if none exists.
    """
    from apps.lab.models import HospitalLabConfig, LabSlot

    try:
        config = HospitalLabConfig.objects.get(hospital_id=hospital, is_active=True)
    except HospitalLabConfig.DoesNotExist:
        config = HospitalLabConfig.objects.create(
            hospital_id=hospital,
            working_days=[0, 1, 2, 3, 4, 5],
            start_time=time(8, 0),
            end_time=time(18, 0),
            slot_duration_minutes=30,
            max_patients_per_slot=5,
            lunch_break_start=time(13, 0),
            lunch_break_end=time(14, 0),
        )

    today = date.today()
    slots_created = 0
    slot_duration = timedelta(minutes=config.slot_duration_minutes or 30)

    for day_offset in range(1, (days_ahead or config.advance_booking_days) + 1):
        slot_date = today + timedelta(days=day_offset)
        if slot_date.weekday() not in (config.working_days or []):
            continue

        current_time = datetime.combine(slot_date, config.start_time)
        end_datetime = datetime.combine(slot_date, config.end_time)

        while current_time < end_datetime:
            slot_start = current_time.time()
            slot_end = (current_time + slot_duration).time()

            # Skip slots that start during the lunch break.
            if config.lunch_break_start and config.lunch_break_end:
                if config.lunch_break_start <= slot_start < config.lunch_break_end:
                    current_time += slot_duration
                    continue

            _, created = LabSlot.objects.get_or_create(
                hospital_id=hospital,
                slot_date=slot_date,
                start_time=slot_start,
                defaults={
                    'end_time': slot_end,
                    'max_patients': config.max_patients_per_slot,
                    'is_blocked': False,
                },
            )
            if created:
                slots_created += 1

            current_time += slot_duration

    print(f"[SLOTS] Generated {slots_created} new slots for {hospital.hospital_name}")
    return slots_created
