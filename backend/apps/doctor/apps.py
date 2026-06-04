import os
import sys
import threading
import time
from datetime import datetime

from django.apps import AppConfig


class DoctorConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.doctor'

    def ready(self):
        # Only spin up the scheduler thread in the long-running server process —
        # not for management commands like makemigrations / migrate / shell.
        # Under runserver's auto-reloader, RUN_MAIN is 'true' only in the child
        # process that actually serves requests.
        argv = sys.argv
        is_runserver_child = 'runserver' in argv and os.environ.get('RUN_MAIN') == 'true'
        is_server_entrypoint = not any(
            cmd in argv for cmd in (
                'makemigrations', 'migrate', 'shell', 'collectstatic',
                'check', 'createsuperuser', 'send_appointment_reminders',
                'test', 'dbshell',
            )
        ) and 'manage.py' not in argv[-1:]

        if not (is_runserver_child or is_server_entrypoint):
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
