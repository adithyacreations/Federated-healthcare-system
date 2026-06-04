from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = (
        'Recalculate every PharmacyInventory.reserved_quantity from the live, '
        'still-held reservations (unpaid orders that are reserved, not cancelled '
        'and not past their expiry). Repairs stale values left by orders that '
        'were paid/cancelled/expired before the release logic was wired up.'
    )

    def handle(self, *args, **options):
        from django.utils import timezone
        from apps.pharmacy.models import PharmacyInventory, MedicineOrder

        now = timezone.now()

        # Orders that legitimately still hold stock: reserved + unpaid + not
        # cancelled. (Rx orders have no expiry; non-Rx hold until their deadline.)
        active = (
            MedicineOrder.objects
            .filter(stock_reserved=True, payment_status='pending')
            .exclude(order_status='cancelled')
        )

        held = {}  # inventory_id (str) -> total reserved units
        for order in active:
            expires = order.reservation_expires_at
            if expires is not None and expires <= now:
                continue  # lapsed — no longer holding
            for line in (order.medicines or []):
                inv = line.get('inventory_id')
                if not inv:
                    continue
                qty = int(line.get('quantity', line.get('qty', 1)) or 1)
                held[str(inv)] = held.get(str(inv), 0) + qty

        fixed = 0
        for inv in PharmacyInventory.objects.all():
            correct = held.get(str(inv.inventory_id), 0)
            if inv.reserved_quantity != correct:
                self.stdout.write(
                    f'Fixed {inv.medicine_name}: {inv.reserved_quantity} -> {correct}'
                )
                inv.reserved_quantity = correct
                inv.save(update_fields=['reserved_quantity', 'updated_at'])
                fixed += 1

        self.stdout.write(self.style.SUCCESS(
            f'Reserved quantities fixed! ({fixed} item(s) corrected)'
        ))
