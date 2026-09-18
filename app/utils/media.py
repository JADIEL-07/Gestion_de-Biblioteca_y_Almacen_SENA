import re

# Solo formatos raster: un SVG (data:image/svg+xml) puede llevar <script> y se
# ejecuta si alguien abre la imagen directamente en el navegador.
_IMAGE_HEADER = re.compile(r"^data:image/(png|jpe?g|webp|gif|bmp);base64$", re.IGNORECASE)
_AUDIO_HEADER = re.compile(r"^data:audio/(webm|ogg|mpeg|mp3|mp4|wav|x-wav|aac)(;codecs=[\w.-]+)?;base64$", re.IGNORECASE)


def _header(value):
    return value.split(",", 1)[0] if isinstance(value, str) and "," in value else ""


def is_safe_image_data_url(value) -> bool:
    return bool(_IMAGE_HEADER.match(_header(value)))


def is_safe_audio_data_url(value) -> bool:
    return bool(_AUDIO_HEADER.match(_header(value)))
