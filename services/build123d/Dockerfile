FROM python:3.11

WORKDIR /code

# Install system dependencies for cadquery-ocp (OpenGL, X11 libraries)
# and git for installing build123d from dev branch.
RUN apt-get update && apt-get install -y \
    libgl1-mesa-dev \
    libglu1-mesa \
    libosmesa6 \
    libegl1 \
    libx11-6 \
    libxext6 \
    libxrender1 \
    libxrandr2 \
    libsm6 \
    libice6 \
    libxt6 \
    git \
    && rm -rf /var/lib/apt/lists/*

COPY ./requirements.txt /code/requirements.txt

# Keep Python dependency installation in its own layers, separate from OS package updates.
RUN pip install --no-cache-dir --retries 50 --timeout 120 --upgrade pip
RUN if pip --help | grep -q -- "--resume-retries"; then \
      pip install --no-cache-dir --retries 50 --resume-retries 50 --timeout 120 --upgrade -r /code/requirements.txt; \
    else \
      pip install --no-cache-dir --retries 50 --timeout 120 --upgrade -r /code/requirements.txt; \
    fi

# gridfinity_build123d pins bd_warehouse to a git commit in its pyproject,
# conflicting with bd_warehouse>=0.2.0 from requirements.txt. Its actual
# dependencies (build123d, bd_warehouse) are already installed above, so
# skip its dependency resolution entirely.
RUN pip install --no-cache-dir --retries 50 --timeout 120 --no-deps \
      "gridfinity_build123d @ git+https://github.com/Ruudjhuu/gridfinity_build123d.git@fc29ac6b9ad5b110c582abef78bf0f1153bec6b3"

# Backport typing.override for Python <3.12 (needed by gridfinity_build123d)
RUN python -c "import typing; typing.override" 2>/dev/null || \
    SITE_DIR=$(python -c "import site; print(site.getsitepackages()[0])") && \
    echo 'import typing; from typing_extensions import override; typing.override = override' \
    > "$SITE_DIR/sitecustomize.py"

# Install ocp_vscode stub — bd_warehouse.gear imports it unconditionally
# but the real package requires a GUI. This stub provides no-op replacements.
RUN SITE_DIR=$(python -c "import site; print(site.getsitepackages()[0])") && \
    mkdir -p "$SITE_DIR/ocp_vscode" && \
    echo 'from .stub import *' > "$SITE_DIR/ocp_vscode/__init__.py"

COPY ./app/ocp_vscode_stub.py /tmp/ocp_vscode_stub.py
RUN SITE_DIR=$(python -c "import site; print(site.getsitepackages()[0])") && \
    cp /tmp/ocp_vscode_stub.py "$SITE_DIR/ocp_vscode/stub.py"

COPY ./app /code/app

# pyrender needs EGL for headless offscreen rendering
ENV PYOPENGL_PLATFORM=egl

# Sweep orphaned render temp dirs (crashed exec() renders leak them into the
# container layer, which survives restarts). Only ever enable inside the container.
ENV BUILD123D_TMP_SWEEP=1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "80"]
