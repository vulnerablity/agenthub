from fastapi import FastAPI

app = FastAPI(
    title="AgentHub API",
    version="0.1.0",
)


@app.get("/health")
async def health_check():
    return {"status": "ok"}
@app.get("test")
async def test():
    return {"test":"success"}