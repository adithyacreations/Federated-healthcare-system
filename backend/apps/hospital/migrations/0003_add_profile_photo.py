from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('hospital', '0002_add_bed'),
    ]

    operations = [
        migrations.AddField(
            model_name='hospitalregistration',
            name='profile_photo',
            field=models.CharField(blank=True, max_length=500),
        ),
    ]
