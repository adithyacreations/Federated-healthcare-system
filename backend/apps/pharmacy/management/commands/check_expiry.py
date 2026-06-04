from datetime import date, timedelta

from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Notify pharmacists about medicines expiring in 30/60/90 days and already-expired stock.'

    def handle(self, *args, **options):
        from apps.pharmacy.models import PharmacyInventory, PharmacistRegistration
        from utils import send_notification
        from email_utils import send_email

        today = date.today()

        levels = [
            (30, '⛔ Expiring in 30 days'),
            (60, '⚠️ Expiring in 60 days'),
            (90, '📅 Expiring in 90 days'),
        ]

        for days, label in levels:
            target_date = today + timedelta(days=days)
            expiring = PharmacyInventory.objects.filter(expiry_date=target_date)

            for item in expiring:
                try:
                    pharmacist = PharmacistRegistration.objects.get(
                        pharmacist_id=item.pharmacy_id_id
                    )

                    send_notification(
                        pharmacist.login_id,
                        f'{label}: {item.medicine_name}',
                        f'{item.medicine_name} expires on {item.expiry_date}. '
                        f'Stock: {item.stock_quantity} units.',
                        notif_type='alert',
                    )

                    try:
                        expiry_color = (
                            '#EF4444' if days <= 30
                            else '#F97316' if days <= 60
                            else '#EAB308'
                        )
                        html = f"""
                        <div style="font-family:Arial;max-width:600px;margin:0 auto;">
                          <div style="background:{expiry_color};padding:20px;text-align:center;border-radius:12px 12px 0 0;">
                            <h1 style="color:white;margin:0;">{label}</h1>
                          </div>
                          <div style="background:#FAF7F2;padding:30px;border-radius:0 0 12px 12px;">
                            <div style="background:white;border-radius:12px;padding:20px;margin-bottom:20px;">
                              <p style="font-size:18px;font-weight:bold;color:#000;margin:0 0 10px 0;">{item.medicine_name}</p>
                              <p style="color:#666;margin:5px 0;"><b>Expiry Date:</b> {item.expiry_date}</p>
                              <p style="color:#666;margin:5px 0;"><b>Stock:</b> {item.stock_quantity} units</p>
                              <p style="color:#666;margin:5px 0;"><b>Category:</b> {item.category}</p>
                            </div>
                            <p style="color:#333;">Please take necessary action to avoid dispensing expired medicines.</p>
                            <p style="color:#999;font-size:12px;margin-top:20px;">FederCare: AI Health Network</p>
                          </div>
                        </div>
                        """
                        send_email(
                            to_email=pharmacist.login_id.email,
                            subject=f'FederCare: {label} — {item.medicine_name}',
                            html_content=html,
                        )
                    except Exception as e:
                        self.stdout.write(self.style.WARNING(f'Expiry email error: {e}'))

                    self.stdout.write(
                        f'Alert sent: {item.medicine_name} expires {item.expiry_date}'
                    )
                except Exception as e:
                    self.stdout.write(self.style.WARNING(f'Error: {e}'))

        expired = PharmacyInventory.objects.filter(
            expiry_date__lt=today,
            stock_quantity__gt=0,
        )

        for item in expired:
            try:
                pharmacist = PharmacistRegistration.objects.get(
                    pharmacist_id=item.pharmacy_id_id
                )
                send_notification(
                    pharmacist.login_id,
                    f'🚫 EXPIRED: {item.medicine_name}',
                    f'{item.medicine_name} has EXPIRED on {item.expiry_date}! '
                    f'Remove from inventory immediately!',
                    notif_type='alert',
                )
                self.stdout.write(self.style.ERROR(f'EXPIRED: {item.medicine_name}'))
            except Exception as e:
                self.stdout.write(self.style.WARNING(f'Error: {e}'))

        self.stdout.write(self.style.SUCCESS('Expiry check complete!'))
