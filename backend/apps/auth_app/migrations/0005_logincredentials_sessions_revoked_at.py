from django.db import migrations, models


def clear_stored_temporary_passwords(apps, schema_editor):
    credentials = apps.get_model('auth_app', 'LoginCredentials')
    credentials.objects.using(schema_editor.connection.alias).filter(
        temp_password__isnull=False,
    ).update(temp_password=None)


class Migration(migrations.Migration):
    dependencies = [('auth_app', '0004_logincredentials_force_password_change_and_more')]

    operations = [
        migrations.AddField(
            model_name='logincredentials',
            name='sessions_revoked_at',
            field=models.DateTimeField(null=True, blank=True),
        ),
        migrations.RunPython(clear_stored_temporary_passwords, migrations.RunPython.noop),
    ]
