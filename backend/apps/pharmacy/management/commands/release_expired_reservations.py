from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = (
        'Release expired medicine reservations — cancels unpaid, non-prescription '
        'orders whose 10-minute hold has lapsed and returns their stock. '
        'Safe to run on a cron (e.g. every minute).'
    )

    def handle(self, *args, **options):
        from apps.pharmacy.views import release_expired_reservations
        released = release_expired_reservations()
        self.stdout.write(self.style.SUCCESS(f'Released {released} expired reservation(s).'))
