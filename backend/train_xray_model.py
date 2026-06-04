"""
FederCare — Chest X-Ray Pneumonia Classifier (transfer learning, MobileNetV2).

Two-phase training:
  Phase 1 — frozen MobileNetV2 base, train the custom classifier head.
  Phase 2 — unfreeze the top 30 base layers, fine-tune at a low learning rate.

Run from backend/ with the venv active:
    python train_xray_model.py
"""
import os
import json

import numpy as np
import tensorflow as tf
from tensorflow.keras.applications import MobileNetV2
from tensorflow.keras.layers import (
    Dense, GlobalAveragePooling2D, Dropout, BatchNormalization,
)
from tensorflow.keras.models import Model
from tensorflow.keras.optimizers import Adam
from tensorflow.keras.preprocessing.image import ImageDataGenerator
from tensorflow.keras.callbacks import (
    ModelCheckpoint, EarlyStopping, ReduceLROnPlateau,
)

import matplotlib
matplotlib.use('Agg')  # headless — no display needed
import matplotlib.pyplot as plt


# ─── Paths ──────────────────────────────────────────────────────────────────
BASE_DIR = r"D:\Federated learning healthcare system"
DATASET_DIR = os.path.join(BASE_DIR, 'chest_xray')
TRAIN_DIR = os.path.join(DATASET_DIR, 'train')
TEST_DIR = os.path.join(DATASET_DIR, 'test')
VAL_DIR = os.path.join(DATASET_DIR, 'val')
ML_DIR = os.path.join(BASE_DIR, 'ml_models')
MODEL_SAVE_PATH = os.path.join(ML_DIR, 'chest_xray_model.h5')

os.makedirs(ML_DIR, exist_ok=True)

# ─── Image settings ─────────────────────────────────────────────────────────
IMG_SIZE = (224, 224)
BATCH_SIZE = 32

# ─── Data generators ────────────────────────────────────────────────────────
train_datagen = ImageDataGenerator(
    rescale=1. / 255,
    rotation_range=20,
    width_shift_range=0.2,
    height_shift_range=0.2,
    shear_range=0.2,
    zoom_range=0.2,
    horizontal_flip=True,
    fill_mode='nearest',
)
val_datagen = ImageDataGenerator(rescale=1. / 255)
test_datagen = ImageDataGenerator(rescale=1. / 255)

print("Loading training data...")
train_generator = train_datagen.flow_from_directory(
    TRAIN_DIR, target_size=IMG_SIZE, batch_size=BATCH_SIZE,
    class_mode='binary', shuffle=True,
)
print("Loading validation data...")
val_generator = val_datagen.flow_from_directory(
    VAL_DIR, target_size=IMG_SIZE, batch_size=BATCH_SIZE,
    class_mode='binary', shuffle=False,
)
print("Loading test data...")
test_generator = test_datagen.flow_from_directory(
    TEST_DIR, target_size=IMG_SIZE, batch_size=BATCH_SIZE,
    class_mode='binary', shuffle=False,
)

print(f"Classes: {train_generator.class_indices}")
print(f"Training samples: {train_generator.samples}")
print(f"Validation samples: {val_generator.samples}")
print(f"Test samples: {test_generator.samples}")

# ─── Class weights — the dataset is imbalanced (more PNEUMONIA than NORMAL) ──
counts = np.bincount(train_generator.classes)
total = float(counts.sum())
class_weight = {i: total / (len(counts) * c) for i, c in enumerate(counts)}
print(f"Class weights: {class_weight}")

# ─── Build model ────────────────────────────────────────────────────────────
print("\nBuilding MobileNetV2 model...")
base_model = MobileNetV2(
    weights='imagenet', include_top=False, input_shape=(224, 224, 3),
)
base_model.trainable = False

x = base_model.output
x = GlobalAveragePooling2D()(x)
x = BatchNormalization()(x)
x = Dense(256, activation='relu')(x)
x = Dropout(0.5)(x)
x = Dense(128, activation='relu')(x)
x = Dropout(0.3)(x)
output = Dense(1, activation='sigmoid')(x)

model = Model(inputs=base_model.input, outputs=output)

METRICS = [
    'accuracy',
    tf.keras.metrics.AUC(name='auc'),
    tf.keras.metrics.Precision(name='precision'),
    tf.keras.metrics.Recall(name='recall'),
]

model.compile(optimizer=Adam(learning_rate=0.001),
              loss='binary_crossentropy', metrics=METRICS)
model.summary()
print(f"\nTotal parameters: {model.count_params():,}")

callbacks = [
    ModelCheckpoint(MODEL_SAVE_PATH, monitor='val_accuracy',
                    save_best_only=True, verbose=1),
    EarlyStopping(monitor='val_accuracy', patience=5,
                  restore_best_weights=True, verbose=1),
    ReduceLROnPlateau(monitor='val_loss', factor=0.5, patience=3,
                      min_lr=1e-7, verbose=1),
]

# ─── Phase 1 — frozen base ──────────────────────────────────────────────────
print("\n=== PHASE 1: Training classifier head ===")
history1 = model.fit(
    train_generator, epochs=10, validation_data=val_generator,
    callbacks=callbacks, class_weight=class_weight, verbose=1,
)

# ─── Phase 2 — fine-tune top 30 layers ──────────────────────────────────────
print("\n=== PHASE 2: Fine-tuning top layers ===")
base_model.trainable = True
for layer in base_model.layers[:-30]:
    layer.trainable = False

model.compile(optimizer=Adam(learning_rate=0.0001),
              loss='binary_crossentropy', metrics=METRICS)

history2 = model.fit(
    train_generator, epochs=5, validation_data=val_generator,
    callbacks=callbacks, class_weight=class_weight, verbose=1,
)

# ─── Evaluate ───────────────────────────────────────────────────────────────
print("\n=== FINAL EVALUATION ON TEST SET ===")
test_results = model.evaluate(test_generator, verbose=1)
print(f"\nTest Accuracy: {test_results[1] * 100:.2f}%")
print(f"Test AUC: {test_results[2]:.4f}")
print(f"Test Precision: {test_results[3]:.4f}")
print(f"Test Recall: {test_results[4]:.4f}")

# ─── Save model + class indices ─────────────────────────────────────────────
model.save(MODEL_SAVE_PATH)
print(f"\nModel saved to: {MODEL_SAVE_PATH}")

class_indices = train_generator.class_indices
with open(os.path.join(ML_DIR, 'xray_class_indices.json'), 'w') as f:
    json.dump(class_indices, f)
print(f"Class indices: {class_indices}")

# ─── Training history plot ──────────────────────────────────────────────────
acc = history1.history['accuracy'] + history2.history['accuracy']
val_acc = history1.history['val_accuracy'] + history2.history['val_accuracy']
loss = history1.history['loss'] + history2.history['loss']
val_loss = history1.history['val_loss'] + history2.history['val_loss']

fig, axes = plt.subplots(1, 2, figsize=(12, 4))
axes[0].plot(acc, label='Train Accuracy')
axes[0].plot(val_acc, label='Val Accuracy')
axes[0].set_title('Model Accuracy')
axes[0].legend()
axes[1].plot(loss, label='Train Loss')
axes[1].plot(val_loss, label='Val Loss')
axes[1].set_title('Model Loss')
axes[1].legend()
plt.tight_layout()
plt.savefig(os.path.join(ML_DIR, 'xray_training_history.png'))
print("Training plot saved!")

print("\nTraining Complete!")
print(f"Model: {MODEL_SAVE_PATH}")
print(f"Test Accuracy: {test_results[1] * 100:.2f}%")
