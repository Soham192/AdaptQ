FROM node:20-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY jugaadflow/ jugaadflow/
COPY --from=frontend /app/frontend/dist frontend/dist
CMD ["python", "-m", "jugaadflow.main"]
