from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = (
        'Send 30-minute lab appointment reminders and auto-mark missed '
        'appointments as no_show (slot end + 30 min). Safe to run on a cron '
        '(e.g. every 5 minutes).'
    )

    def handle(self, *args, **options):
        from datetime import timedelta
        from django.utils import timezone
        from apps.patient.models import LabTestOrder
        from apps.lab.utils import detect_and_mark_no_shows, fmt_12hr, _test_label
        from utils import send_notification, db_save_with_retry

        now = timezone.localtime(timezone.now())
        today = now.date()

        # ── Part 1: 30-minute reminders ──────────────────────────────────
        window_start = (now + timedelta(minutes=25)).time()
        window_end = (now + timedelta(minutes=35)).time()

        upcoming = (
            LabTestOrder.objects
            .filter(
                status='confirmed', payment_status='paid',
                reminder_30min_sent=False,
                slot_id__slot_date=today,
                slot_id__start_time__gte=window_start,
                slot_id__start_time__lte=window_end,
            )
            .select_related('patient_id', 'slot_id', 'hospital_id', 'patient_id__login_id')
        )

        reminders_sent = 0
        for order in list(upcoming):
            try:
                patient = order.patient_id
                test_name = _test_label(order)
                time_str = fmt_12hr(order.slot_id.start_time) if order.slot_id else ''
                hospital_name = order.hospital_id.hospital_name if order.hospital_id else 'the hospital'

                send_notification(
                    patient.login_id,
                    '⏰ Lab Test in 30 Minutes!',
                    f'Your {test_name} is scheduled at {time_str} today at '
                    f'{hospital_name}. Please arrive on time!',
                    notif_type='lab',
                )
                self._send_reminder_email(patient, test_name, time_str, hospital_name)

                order.reminder_30min_sent = True
                db_save_with_retry(order, update_fields=['reminder_30min_sent'])
                reminders_sent += 1
                self.stdout.write(f'Reminder: {patient.full_name} - {test_name} @ {time_str}')
            except Exception as e:  # noqa: BLE001
                self.stdout.write(f'Reminder error: {e}')

        # ── Part 2: auto-detect no-shows (shared with the on-read sweep) ──
        no_shows = detect_and_mark_no_shows()

        self.stdout.write(self.style.SUCCESS(
            f'Done. Reminders sent: {reminders_sent} | No-shows marked: {no_shows}'
        ))

    @staticmethod
    def _send_reminder_email(patient, test_name, time_str, hospital_name):
        try:
            from email_utils import send_email
            html = f"""
            <div style="font-family:Arial;max-width:600px;margin:0 auto;">
              <div style="background:#F97316;padding:20px;text-align:center;border-radius:12px 12px 0 0;">
                <h1 style="color:white;margin:0;font-size:20px;">⏰ Lab Test in 30 Minutes!</h1>
              </div>
              <div style="background:#FAF7F2;padding:30px;border-radius:0 0 12px 12px;">
                <p style="color:#333;font-size:16px;">Hi <b>{patient.full_name}</b>!</p>
                <div style="background:white;border-radius:12px;padding:20px;border:1px solid #E5E5E5;margin:16px 0;">
                  <p style="margin:0 0 8px;font-weight:700;">🔬 {test_name}</p>
                  <p style="margin:0 0 4px;color:#666;">🕐 Today at <b style="color:#F97316;">{time_str}</b></p>
                  <p style="margin:0;color:#666;">🏥 {hospital_name}</p>
                </div>
                <div style="background:#FFF7ED;border-left:4px solid #F97316;padding:12px 16px;border-radius:8px;">
                  <p style="margin:0;color:#F97316;font-weight:600;font-size:13px;">
                    📍 Please arrive 10 minutes early. Bring any required documents.
                  </p>
                </div>
                <p style="color:#999;font-size:12px;margin-top:20px;text-align:center;">FederCare: AI Health Network</p>
              </div>
            </div>
            """
            send_email(
                to_email=patient.login_id.email,
                subject=f'⏰ FederCare: Lab Test Reminder — {time_str} Today',
                html_content=html,
            )
        except Exception as e:  # noqa: BLE001
            print(f'[no-show reminder email] {e}')
