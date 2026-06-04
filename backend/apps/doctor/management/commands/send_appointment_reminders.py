from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone


class Command(BaseCommand):
    help = 'Send appointment reminders 1 hour before each consultation.'

    def handle(self, *args, **options):
        from apps.doctor.models import Consultation
        from utils import send_notification
        from email_utils import send_email

        now = timezone.localtime(timezone.now())
        today = now.date()

        # Window: appointments starting in ~55-65 minutes from now.
        reminder_start = (now + timedelta(minutes=55)).time()
        reminder_end = (now + timedelta(minutes=65)).time()

        upcoming = Consultation.objects.filter(
            status='scheduled',
            payment_status='paid',
            slot_id__slot_date=today,
            slot_id__start_time__gte=reminder_start,
            slot_id__start_time__lte=reminder_end,
        ).select_related('patient_id', 'patient_id__login_id', 'doctor_id', 'doctor_id__login_id', 'slot_id')

        self.stdout.write(f'Found {upcoming.count()} upcoming consultations')

        sent = 0
        for consultation in upcoming:
            try:
                patient = consultation.patient_id
                doctor = consultation.doctor_id
                slot = consultation.slot_id

                # Respect the patient's reminder preference (default ON).
                if not getattr(patient, 'reminder_enabled', True):
                    self.stdout.write(f'Reminders disabled for {patient.full_name}')
                    continue

                start_time = slot.start_time.strftime('%I:%M %p')
                consult_type = getattr(slot, 'consult_type', 'online')
                doctor_specialization = getattr(doctor, 'specialization', '') or 'Doctor'

                send_notification(
                    patient.login_id,
                    '⏰ Reminder: Consultation in 1 Hour!',
                    f'Your consultation with Dr. {doctor.full_name} starts at {start_time}. '
                    f'Please be ready!',
                    notif_type='consultation',
                    related_id=str(consultation.consultation_id),
                )

                if consult_type == 'online':
                    prep_items = [
                        '<li style="margin:4px 0;">Ensure stable internet connection</li>',
                        '<li style="margin:4px 0;">Find a quiet private space</li>',
                        '<li style="margin:4px 0;">Keep your EHR code ready</li>',
                        '<li style="margin:4px 0;">Have your medicines list handy</li>',
                    ]
                    cta = (
                        '<div style="text-align:center;margin:20px 0;">'
                        '<a href="http://localhost:3000/patient/consultations" '
                        'style="background:#F97316;color:white;padding:14px 32px;'
                        'border-radius:999px;text-decoration:none;font-weight:bold;'
                        'font-size:16px;">Join Consultation →</a></div>'
                    )
                    type_label = 'Online Video Call'
                else:
                    prep_items = [
                        '<li style="margin:4px 0;">Arrive 10 minutes early</li>',
                        '<li style="margin:4px 0;">Bring your ID and insurance card</li>',
                        '<li style="margin:4px 0;">Carry previous prescriptions</li>',
                        '<li style="margin:4px 0;">List your current symptoms</li>',
                    ]
                    cta = ''
                    type_label = 'Physical Visit'

                try:
                    html = f"""
                    <div style="font-family:Arial;max-width:600px;margin:0 auto;">
                      <div style="background:#F97316;padding:20px;text-align:center;border-radius:12px 12px 0 0;">
                        <h1 style="color:white;margin:0;">⏰ Appointment Reminder</h1>
                        <p style="color:#FFF7ED;margin:8px 0 0 0;">Your consultation starts in 1 hour!</p>
                      </div>
                      <div style="background:#FAF7F2;padding:30px;border-radius:0 0 12px 12px;">
                        <p style="color:#333;font-size:16px;">Hi <b>{patient.full_name}</b>!</p>

                        <div style="background:white;border:2px solid #FED7AA;border-radius:16px;padding:20px;margin:20px 0;">
                          <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
                            <div style="background:#F97316;color:white;width:48px;height:48px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0;">👨‍⚕️</div>
                            <div>
                              <p style="margin:0;font-weight:bold;font-size:18px;color:#000;">Dr. {doctor.full_name}</p>
                              <p style="margin:4px 0 0 0;color:#666;font-size:14px;">{doctor_specialization}</p>
                            </div>
                          </div>
                          <div style="border-top:1px solid #F3F4F6;padding-top:16px;">
                            <p style="margin:8px 0;color:#666;">📅 <b>Date:</b> {today.strftime('%d %B %Y')}</p>
                            <p style="margin:8px 0;color:#666;">🕐 <b>Time:</b> <span style="color:#F97316;font-weight:bold;font-size:18px;">{start_time}</span></p>
                            <p style="margin:8px 0;color:#666;">💻 <b>Type:</b> {type_label}</p>
                          </div>
                        </div>

                        <div style="background:#FFF7ED;border-left:4px solid #F97316;padding:16px;border-radius:8px;margin-bottom:20px;">
                          <p style="margin:0;font-weight:bold;color:#F97316;">📋 Before Your Consultation:</p>
                          <ul style="margin:8px 0 0 0;padding-left:20px;color:#666;">
                            {''.join(prep_items)}
                          </ul>
                        </div>

                        {cta}

                        <p style="color:#999;font-size:12px;margin-top:20px;text-align:center;">
                          FederCare: AI Health Network<br>MRIT, Ayur, Kollam, Kerala
                        </p>
                      </div>
                    </div>
                    """
                    send_email(
                        to_email=patient.login_id.email,
                        subject=f'⏰ FederCare: Consultation Reminder — {start_time} Today',
                        html_content=html,
                    )
                    self.stdout.write(
                        f'✅ Reminder sent to {patient.full_name} for {start_time}'
                    )
                except Exception as e:
                    self.stdout.write(self.style.WARNING(f'Email error: {e}'))

                try:
                    send_notification(
                        doctor.login_id,
                        '📅 Upcoming Consultation in 1 Hour',
                        f'Consultation with {patient.full_name} starts at {start_time}.',
                        notif_type='consultation',
                        related_id=str(consultation.consultation_id),
                    )
                except Exception as e:
                    print(f'Doctor notify error: {e}')

                sent += 1
            except Exception as e:
                self.stdout.write(self.style.WARNING(f'Error for consultation: {e}'))

        self.stdout.write(self.style.SUCCESS(f'Reminders sent: {sent}'))
