# Renames and updates TriageSession fields to match final spec

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('ai_engine', '0001_initial'),
    ]

    operations = [
        # Rename symptoms → symptoms_input
        migrations.RenameField(
            model_name='triagesession',
            old_name='symptoms',
            new_name='symptoms_input',
        ),
        # Rename recommendations → recommendation
        migrations.RenameField(
            model_name='triagesession',
            old_name='recommendations',
            new_name='recommendation',
        ),
        # Rename escalated_to_emergency → emergency_triggered
        migrations.RenameField(
            model_name='triagesession',
            old_name='escalated_to_emergency',
            new_name='emergency_triggered',
        ),
        # Remove old predicted_disease CharField
        migrations.RemoveField(
            model_name='triagesession',
            name='predicted_disease',
        ),
        # Add predicted_diseases JSONField
        migrations.AddField(
            model_name='triagesession',
            name='predicted_diseases',
            field=models.JSONField(default=list),
        ),
        # Add model_version CharField
        migrations.AddField(
            model_name='triagesession',
            name='model_version',
            field=models.CharField(blank=True, max_length=20),
        ),
    ]
