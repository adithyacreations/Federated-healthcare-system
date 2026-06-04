from datetime import time

from django.core.management.base import BaseCommand

SLOT_RULES = [
    {'keyword': 'blood sugar fasting', 'restriction': 'morning', 'start': '08:00', 'end': '11:00', 'fasting': True, 'fasting_hours': 8, 'note': 'Must fast 8-10 hours before test. Morning slots only.'},
    {'keyword': 'lipid profile', 'restriction': 'morning', 'start': '08:00', 'end': '11:00', 'fasting': True, 'fasting_hours': 12, 'note': 'Must fast 12 hours. Morning slots only.'},
    {'keyword': 'hba1c', 'restriction': 'any', 'fasting': False, 'note': 'No fasting required. Any time slot.'},
    {'keyword': 'cortisol', 'restriction': 'specific', 'start': '08:00', 'end': '09:30', 'fasting': False, 'note': 'Must be collected 8:00-9:30 AM for accurate results.'},
    {'keyword': 'prolactin', 'restriction': 'morning', 'start': '08:00', 'end': '11:00', 'fasting': False, 'note': 'Morning sample preferred for accuracy.'},
    {'keyword': 'fsh', 'restriction': 'morning', 'start': '08:00', 'end': '11:00', 'fasting': False, 'note': 'Morning collection preferred.'},
    {'keyword': 'testosterone', 'restriction': 'morning', 'start': '07:00', 'end': '10:00', 'fasting': False, 'note': 'Must collect 7:00-10:00 AM (peak levels).'},
    {'keyword': 'liver function', 'restriction': 'morning', 'start': '08:00', 'end': '11:00', 'fasting': True, 'fasting_hours': 8, 'note': 'Fast 8 hours before test.'},
    {'keyword': 'kidney function', 'restriction': 'any', 'fasting': False, 'note': 'No special timing required.'},
    {'keyword': 'iron studies', 'restriction': 'morning', 'start': '08:00', 'end': '11:00', 'fasting': True, 'fasting_hours': 8, 'note': 'Fast 8 hours before test.'},
    {'keyword': 'insulin', 'restriction': 'morning', 'start': '08:00', 'end': '10:00', 'fasting': True, 'fasting_hours': 8, 'note': 'Fasting insulin - must fast 8 hours.'},
    {'keyword': 'troponin', 'restriction': 'any', 'fasting': False, 'note': 'Urgent test - any time slot.'},
]


def _parse(t):
    if not t:
        return None
    parts = [int(x) for x in t.split(':')]
    return time(*parts)


class Command(BaseCommand):
    help = 'Seed lab slot rules'

    def handle(self, *args, **options):
        from apps.lab.models import LabTestSlotRule

        created = 0
        for rule in SLOT_RULES:
            _, was_created = LabTestSlotRule.objects.get_or_create(
                test_name_keyword=rule['keyword'],
                defaults={
                    'time_restriction': rule.get('restriction', 'any'),
                    'allowed_start': _parse(rule.get('start')),
                    'allowed_end': _parse(rule.get('end')),
                    'requires_fasting': rule.get('fasting', False),
                    'fasting_hours': rule.get('fasting_hours', 0),
                    'preparation_note': rule.get('note', ''),
                },
            )
            if was_created:
                created += 1

        self.stdout.write(self.style.SUCCESS(f'Created {created} slot rules!'))
