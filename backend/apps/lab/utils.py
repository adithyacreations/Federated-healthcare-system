"""Lab slot helpers — auto-generation and 12-hour time formatting."""
from datetime import datetime, timedelta

from django.utils import timezone


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


LAB_BOOKING_DAYS = 30


def generate_lab_slots(config, *, start_date=None, days_ahead=LAB_BOOKING_DAYS):
    """Fill missing slots in a date range without changing existing bookings."""
    from apps.lab.models import LabSlot

    if not config.is_active or config.slot_duration_minutes <= 0:
        return

    start_date = start_date or timezone.localdate() + timedelta(days=1)
    end_date = start_date + timedelta(days=days_ahead - 1)
    working_days = config.working_days or []
    dates = [
        start_date + timedelta(days=offset) for offset in range(days_ahead)
        if (start_date.weekday() + offset) % 7 in working_days
    ]
    if not dates:
        return

    hospital_id = config.hospital_id_id
    existing = set(LabSlot.objects.filter(
        hospital_id_id=hospital_id, slot_date__range=(start_date, end_date),
    ).order_by().values_list('slot_date', 'start_time'))
    duration = timedelta(minutes=config.slot_duration_minutes)
    new_slots = []
    for slot_date in dates:
        current_time = datetime.combine(slot_date, config.start_time)
        end_datetime = datetime.combine(slot_date, config.end_time)

        while current_time < end_datetime:
            slot_start = current_time.time()
            current_time += duration
            during_lunch = (
                config.lunch_break_start and config.lunch_break_end
                and config.lunch_break_start <= slot_start < config.lunch_break_end
            )
            if during_lunch or (slot_date, slot_start) in existing:
                continue
            new_slots.append(LabSlot(
                hospital_id_id=hospital_id, slot_date=slot_date, start_time=slot_start,
                end_time=current_time.time(), max_patients=config.max_patients_per_slot,
            ))

    # A concurrent request may have already filled the same missing slots.
    LabSlot.objects.bulk_create(new_slots, batch_size=500, ignore_conflicts=True)
