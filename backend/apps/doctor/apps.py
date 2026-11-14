import os
import sys
import threading
import time
from datetime import datetime

from django.apps import AppConfig
from django.conf import settings


class DoctorConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.doctor'

    def ready(self):
        # Production reminders run in one scheduled job, outside web processes.
        # With the local autoreloader, only the serving child starts a thread.
        if not settings.DEBUG or len(sys.argv) < 2 or sys.argv[1] != 'runserver':
            return
        if os.environ.get('RUN_MAIN') != 'true' and '--noreload' not in sys.argv:
            return

        def run_reminder_scheduler():
            # Wait for Django to finish booting before the first sweep.
            time.sleep(10)
            print('[REMINDER] Scheduler started!')

            last_ran_minute = None
            while True:
                try:
                    now = datetime.now()
                    # Fire once per 5-minute boundary (keeps SQLite write load low).
                    if now.minute % 5 == 0 and now.minute != last_ran_minute:
                        from django.core.management import call_command
                        call_command('send_appointment_reminders')
                        print(f"[REMINDER] Checked at {now.strftime('%H:%M')}")
                        last_ran_minute = now.minute
                    # Idle poll — 60s is plenty to catch each 5-min boundary while
                    # minimising background wake-ups / DB contention.
                    time.sleep(60)
                except Exception as e:
                    print(f'[REMINDER] Error: {e}')
                    time.sleep(60)

        thread = threading.Thread(target=run_reminder_scheduler, daemon=True)
        thread.start()
