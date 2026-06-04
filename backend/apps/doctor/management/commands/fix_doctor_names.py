import re

from django.core.management.base import BaseCommand

# Matches a DUPLICATED leading "Dr." prefix (two or more "Dr"/"Dr." tokens, each
# followed by a separator). Requiring a separator avoids eating real names that
# merely start with "Dr" (e.g. "Drake"). Single-prefix and bare names are left
# untouched so we never create new duplicates elsewhere.
DOUBLE_DR = re.compile(r'^(?:dr\.\s*|dr\s+){2,}', re.IGNORECASE)


def collapse_duplicate_dr(name):
    if not name:
        return name
    stripped = name.strip()
    if not DOUBLE_DR.match(stripped):
        return name
    rest = DOUBLE_DR.sub('', stripped).strip()
    return f'Dr. {rest}' if rest else name


class Command(BaseCommand):
    help = "Collapse duplicated 'Dr. Dr.' prefixes in stored doctor names to a single 'Dr.'"

    def handle(self, *args, **options):
        from apps.doctor.models import DoctorRegistration

        fixed = 0
        for doctor in DoctorRegistration.objects.all():
            original = doctor.full_name or ''
            cleaned = collapse_duplicate_dr(original)
            if cleaned != original:
                doctor.full_name = cleaned
                doctor.save(update_fields=['full_name'])
                fixed += 1
                self.stdout.write(f'Fixed: "{original}" -> "{cleaned}"')

        self.stdout.write(self.style.SUCCESS(f'Fixed {fixed} doctor name(s)!'))
