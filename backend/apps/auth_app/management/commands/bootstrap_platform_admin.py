import os

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.core.validators import validate_email
from django.db import connection, transaction
from django.db.migrations.executor import MigrationExecutor

from apps.auth_app.models import LoginCredentials, SuperAdmin


class Command(BaseCommand):
    help = 'Provision the custom FederCare Platform Super Admin after migrations.'

    def handle(self, *args, **options):
        email = os.getenv('FEDERCARE_ADMIN_EMAIL', '').strip().lower()
        full_name = os.getenv('FEDERCARE_ADMIN_NAME', 'Platform Super Admin').strip()
        password = os.getenv('FEDERCARE_ADMIN_PASSWORD')

        try:
            validate_email(email)
        except ValidationError:
            raise CommandError('Set FEDERCARE_ADMIN_EMAIL to a valid email address.') from None
        if len(email) > LoginCredentials._meta.get_field('email').max_length:
            raise CommandError('FEDERCARE_ADMIN_EMAIL is too long.')
        if not full_name or len(full_name) > SuperAdmin._meta.get_field('full_name').max_length:
            raise CommandError('FEDERCARE_ADMIN_NAME must contain 1 to 120 characters.')

        executor = MigrationExecutor(connection)
        if executor.migration_plan(executor.loader.graph.leaf_nodes()):
            raise CommandError('Apply database migrations before bootstrapping the Platform Super Admin.')

        with transaction.atomic():
            if connection.vendor == 'postgresql':
                # Serialize provisioning, including simultaneous runs using different emails.
                table = connection.ops.quote_name(LoginCredentials._meta.db_table)
                with connection.cursor() as cursor:
                    cursor.execute(f'LOCK TABLE {table} IN SHARE ROW EXCLUSIVE MODE')

            login = self.provision_login(email, password)
            _, profile_created = SuperAdmin.objects.get_or_create(
                login_id=login,
                defaults={'full_name': full_name},
            )

        if profile_created:
            self.stdout.write(self.style.SUCCESS('Platform Super Admin profile is ready.'))
        else:
            self.stdout.write(self.style.SUCCESS('Platform Super Admin already exists.'))

    def provision_login(self, email, password):
        matching = list(LoginCredentials.objects.filter(email__iexact=email)[:2])
        if len(matching) > 1:
            raise CommandError('Multiple accounts match the configured admin email.')
        login = matching[0] if matching else None
        if login and login.role != 'super_admin':
            raise CommandError('The configured email belongs to another role. Choose a different admin email.')

        admins = LoginCredentials.objects.filter(role='super_admin')
        if login:
            admins = admins.exclude(pk=login.pk)
        if admins.exists():
            raise CommandError('A different Platform Super Admin already exists. Review the configured admin email.')

        if login:
            if login.email != email:
                raise CommandError('The existing admin email must be lowercase to match the login lookup.')
            if not login.is_active or not login.is_approved:
                raise CommandError('The existing Platform Super Admin is inactive or unapproved. Review its status manually.')
            return login

        if not password or len(password) < 12 or password != password.strip():
            raise CommandError('Set FEDERCARE_ADMIN_PASSWORD to at least 12 characters without surrounding whitespace.')
        try:
            validate_password(password)
        except ValidationError:
            raise CommandError('FEDERCARE_ADMIN_PASSWORD does not pass Django password validation.') from None

        login = LoginCredentials(email=email, role='super_admin', is_active=True, is_approved=True)
        login.set_password(password)
        login.save(force_insert=True)
        return login
