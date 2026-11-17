from django.db import migrations, models


def preserve_previous_refunds(apps, schema_editor):
    order = apps.get_model('vendor', 'EquipmentOrder')
    order.objects.using(schema_editor.connection.alias).filter(payment_status='refunded').update(
        stock_released=True, refund_status='processed',
    )


class Migration(migrations.Migration):
    dependencies = [('vendor', '0005_equipmentcatalog_max_order_qty')]
    operations = [
        migrations.AddField(model_name='equipmentorder', name='refund_id', field=models.CharField(max_length=100, blank=True)),
        migrations.AddField(model_name='equipmentorder', name='refund_status', field=models.CharField(max_length=20, blank=True)),
        migrations.AddField(model_name='equipmentorder', name='refund_requested_at', field=models.DateTimeField(null=True, blank=True)),
        migrations.AddField(model_name='equipmentorder', name='stock_released', field=models.BooleanField(default=False)),
        migrations.AddField(model_name='equipmentorder', name='return_inventory_reserved', field=models.BooleanField(default=False)),
        migrations.RunPython(preserve_previous_refunds, migrations.RunPython.noop),
    ]
