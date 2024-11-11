from fastapi import FastAPI, File, UploadFile
import whisper
import os

app = FastAPI()

# Загружаем модель Whisper при запуске сервера
model = whisper.load_model("base")

@app.post("/transcribe/")
async def transcribe_audio(file: UploadFile = File(...)):
    file_location = f"temp_{file.filename}"
    with open(file_location, "wb") as buffer:
        buffer.write(await file.read())

    result = model.transcribe(file_location)
    os.remove(file_location)  # Удаляем временный файл

    return {"text": result["text"]}
