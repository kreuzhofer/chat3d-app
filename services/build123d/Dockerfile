FROM --platform=linux/amd64 python:3.11

WORKDIR /code

# Install system dependencies for cadquery-ocp (OpenGL, X11 libraries)
RUN apt-get update && apt-get install -y \
    libgl1-mesa-dev \
    libx11-6 \
    libxext6 \
    libxrender1 \
    libxrandr2 \
    libsm6 \
    libice6 \
    libxt6 \
    && rm -rf /var/lib/apt/lists/*

COPY ./requirements.txt /code/requirements.txt

# Keep Python dependency installation in its own layers, separate from OS package updates.
RUN pip install --no-cache-dir --retries 50 --timeout 120 --upgrade pip
RUN if pip --help | grep -q -- "--resume-retries"; then \
      pip install --no-cache-dir --retries 50 --resume-retries 50 --timeout 120 --upgrade -r /code/requirements.txt; \
    else \
      pip install --no-cache-dir --retries 50 --timeout 120 --upgrade -r /code/requirements.txt; \
    fi

COPY ./app /code/app

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "80"]
