# chat3d-build123d-docker

A Docker image running build123d with FastAPI for executing 3D CAD operations and generating STEP files.

## Features

- FastAPI web service with build123d CAD library
- GET endpoint for predefined box generation
- POST endpoint for custom code execution
- Dynamic STEP file generation and download
- Comprehensive error handling

## Building the Container

Build the Docker image using docker-compose:

```bash
docker-compose build
```

Or build directly with Docker:

```bash
docker build -t chat3d-build123d-docker .
```

## Running the Service

Start the service using docker-compose:

```bash
docker-compose up
```

Or run the container directly:

```bash
docker run -p 30222:80 chat3d-build123d-docker
```

The service will be available at `http://localhost:8000`

## API Endpoints

### GET /render/

Generates a predefined 10x10x10 box and returns the STEP file.

**Example:**
```bash
curl -O http://localhost:30222/render/
```

### POST /render/

Executes custom build123d code and returns the generated STEP file in the response body.

**Request Body:**
```json
{
  "code": "string - The build123d Python code to execute",
  "filename": "string - Output filename (optional, defaults to 'output.step')"
}
```

## Postman Example

### Setup

1. Create a new POST request to `http://localhost:30222/render/`
2. Set Headers:
   - `Content-Type`: `application/json`
3. Set Body to raw JSON with the following:

### Request Example

```json
{
  "code": "with BuildPart() as box_builder:\n    Box(20, 30, 40)\n    export_step(box_builder.part, 'custom_box.step')",
  "filename": "custom_box.step"
}
```

### Alternative Code Examples

**Create a cylinder:**
```json
{
  "code": "with BuildPart() as cylinder_builder:\n    Cylinder(10, 50)\n    export_step(cylinder_builder.part, 'cylinder.step')",
  "filename": "cylinder.step"
}
```

**Create a more complex assembly:**
```json
{
  "code": "with BuildPart() as assembly:\n    with Locations((0, 0, 0)):\n        Box(20, 20, 20)\n    with Locations((25, 0, 0)):\n        Cylinder(10, 30)\n    export_step(assembly.part, 'assembly.step')",
  "filename": "assembly.step"
}
```

### Expected Response

**Success Response (200 OK):**
- Content-Type: `application/octet-stream`
- Content-Disposition: `attachment; filename=custom_box.step`
- Body: Binary STEP file content

**Error Responses:**

**Syntax Error (400 Bad Request):**
```json
{
  "detail": "Syntax error in code: invalid syntax (<string>, line 1)"
}
```

**Name Error (400 Bad Request):**
```json
{
  "detail": "Name error in code: name 'UndefinedFunction' is not defined"
}
```

**Execution Error (500 Internal Server Error):**
```json
{
  "detail": "Execution error: Build123d error message\nFull traceback details..."
}
```

**File Generation Failed (400 Bad Request):**
```json
{
  "detail": "Failed to generate file"
}
```

## Testing with curl

```bash
curl -X POST "http://localhost:30222/render/" \
  -H "Content-Type: application/json" \
  -d '{
    "code": "with BuildPart() as box_builder:\n    Box(15, 25, 35)\n    export_step(box_builder.part, \"test_box.step\")",
    "filename": "test_box.step"
  }' \
  --output test_box.step
```

## Important Notes

- The executed code must import build123d functions (they're available globally)
- Code must include an `export_step()` call to generate the output file
- Generated files are automatically cleaned up after being returned
- All code execution happens in a sandboxed environment
- Use proper error handling in your custom code for better debugging

## Development

The service runs on Python with FastAPI and build123d. See `requirements.txt` for dependencies.
