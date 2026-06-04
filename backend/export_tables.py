import os, django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'federcare.settings')
django.setup()
from django.apps import apps

with open('all_tables.txt', 'w', encoding='utf-8') as f:
    for app in apps.get_app_configs():
        if app.name.startswith('apps.'):
            for model in app.get_models():
                f.write('MODEL: ' + model.__name__ + '\n')
                f.write('TABLE: ' + model._meta.db_table + '\n')
                for field in model._meta.fields:
                    null = 'NULL' if field.null else 'NOT NULL'
                    pk = 'Primary Key' if field.primary_key else ''
                    uniq = 'Unique' if field.unique and not field.primary_key else ''
                    fk = ''
                    if hasattr(field, 'related_model') and field.related_model:
                        fk = 'FK to ' + field.related_model.__name__
                    constraints = ', '.join(filter(None, [pk, uniq, fk, null]))
                    f.write('  ' + field.name + '|' + field.get_internal_type() + '|' + constraints + '\n')
                f.write('---\n')

print('Done! Check all_tables.txt')