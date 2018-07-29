# firebase-storage-image-manipulations

## generateResizedImages
listens to uploads to gcs storage, and creates resized copies if eliglible image was uploaded.

Relies on the image being of MIME 'image/..' AND file name to end with the string '_xoriginal' from constants.json
