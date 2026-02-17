from typing import Union, List
import os
import traceback
import logging
import base64
import glob

from fastapi import FastAPI, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

class RenderRequest(BaseModel):
    code: str
    filename: str = "output.step"

class FileData(BaseModel):
    filename: str
    content: str  # base64 encoded binary content

class RenderResponse(BaseModel):
    success: bool
    files: List[FileData] = []
    message: str = ""

@app.get("/")
def read_root():
    return {"Hello": "World 4"}

@app.get("/items/{item_id}")
def read_item(item_id: int, q: Union[str, None] = None):
    return {"item_id": item_id, "q": q}

@app.get("/render/")
def render():
    try:
        # Code block to execute as eval from string
        code_to_execute = """
from build123d import *
with BuildPart() as box_builder:
    Box(10, 10, 10)
    export_step(box_builder.part, "box.step")
"""
        
        # Execute the code block
        exec(code_to_execute)
        
        # Find all files starting with "box" (without extension)
        base_filename = "box"
        pattern = f"{base_filename}*"
        matching_files = glob.glob(pattern)
        
        files_data = []
        for file_path in matching_files:
            if os.path.isfile(file_path):
                with open(file_path, 'rb') as f:
                    file_content = f.read()
                encoded_content = base64.b64encode(file_content).decode('utf-8')
                files_data.append(FileData(
                    filename=os.path.basename(file_path),
                    content=encoded_content
                ))
                # Clean up the file after reading
                os.remove(file_path)
        
        response = RenderResponse(
            success=True,
            files=files_data,
            message=f"Successfully generated {len(files_data)} file(s)"
        )
        return JSONResponse(
            content=response.dict(),
            status_code=status.HTTP_200_OK
        )
        
    except Exception as e:
        error_details = f"Execution error: {str(e)}\n{traceback.format_exc()}"
        logger.error(error_details)
        response = RenderResponse(
            success=False,
            message=error_details
        )
        return JSONResponse(
            content=response.dict(),
            status_code=status.HTTP_202_ACCEPTED
        )

@app.post("/render/")
def render_post(request: RenderRequest):
    try:
        logger.info(f"Starting render_post for file: {request.filename}")
        # Execute the provided code
        logger.info(f"Executing code: {request.code}")
        exec(request.code)
        
        # Extract base filename without extension
        base_filename = os.path.splitext(request.filename)[0]
        pattern = f"{base_filename}*"
        matching_files = glob.glob(pattern)
        
        files_data = []
        for file_path in matching_files:
            if os.path.isfile(file_path):
                with open(file_path, 'rb') as f:
                    file_content = f.read()
                encoded_content = base64.b64encode(file_content).decode('utf-8')
                files_data.append(FileData(
                    filename=os.path.basename(file_path),
                    content=encoded_content
                ))
                # Clean up the file after reading
                os.remove(file_path)
        
        if not files_data:
            response = RenderResponse(
                success=False,
                message="No files were generated matching the specified filename pattern"
            )
            return JSONResponse(
                content=response.dict(),
                status_code=status.HTTP_202_ACCEPTED
            )
        
        response = RenderResponse(
            success=True,
            files=files_data,
            message=f"Successfully generated {len(files_data)} file(s)"
        )
        return JSONResponse(
            content=response.dict(),
            status_code=status.HTTP_200_OK
        )
            
    except SyntaxError as e:
        error_details = f"Syntax error in code: {str(e)}"
        logger.error(error_details)
        response = RenderResponse(
            success=False,
            message=error_details
        )
        return JSONResponse(
            content=response.dict(),
            status_code=status.HTTP_202_ACCEPTED
        )
    except NameError as e:
        error_details = f"Name error in code: {str(e)}"
        logger.error(error_details)
        response = RenderResponse(
            success=False,
            message=error_details
        )
        return JSONResponse(
            content=response.dict(),
            status_code=status.HTTP_202_ACCEPTED
        )
    except Exception as e:
        # Log the full traceback for debugging
        error_details = f"Execution error: {str(e)}\n{traceback.format_exc()}"
        logger.error(error_details)
        response = RenderResponse(
            success=False,
            message=error_details
        )
        return JSONResponse(
            content=response.dict(),
            status_code=status.HTTP_202_ACCEPTED
        )