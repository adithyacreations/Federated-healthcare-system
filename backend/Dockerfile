FROM python:3.11-slim

WORKDIR /app

# System dependencies for psycopg2 / Pillow / cairo-backed PDF rendering /
# cffi-based native wheels. Cairo headers are included even though pycairo
# is no longer in requirements, so an accidental future re-add won't break the
# image build.
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    libpq-dev \
    pkg-config \
    libcairo2-dev \
    python3-dev \
    libffi-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps first so the layer is cached when only code changes.
# Upgrade pip first so its modern resolver can untangle transitive conflicts
# (cryptography ↔ autobahn ↔ pyOpenSSL ↔ channels ↔ daphne).
COPY requirements.txt .
RUN pip install --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Project source
COPY . .

# Media directories used by uploads (Cloudinary covers prod, local for dev)
RUN mkdir -p media/prescriptions \
    media/lab_reports \
    media/medicine_images \
    media/equipment_images \
    media/profile_photos

EXPOSE 8000

CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]
