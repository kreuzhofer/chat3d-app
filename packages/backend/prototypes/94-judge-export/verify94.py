#!/usr/bin/env python3
"""PROTOTYPE (#94): open a judge-sft tarball the way a VLM-SFT loader would.

Checks: every line parses as {id, images, messages[3]}; every image part's
path resolves inside the tarball to a PNG; the manifest's held-out ids do
not intersect the samples; the assistant turn parses as the production
response shape with as many checklist entries as the system prompt asks.
"""
import io, json, re, sys, tarfile

path = sys.argv[1]
tar = tarfile.open(path, "r:gz")
members = {m.name: m for m in tar.getmembers() if m.isfile()}
jsonl = tar.extractfile(members["samples.jsonl"]).read().decode()
manifest = json.load(tar.extractfile(members["manifest.json"]))
held = set(manifest["heldOut"]["exampleIds"])
lines = [json.loads(l) for l in jsonl.split("\n") if l]
assert len(lines) == manifest["counts"]["samples"], (len(lines), manifest["counts"])
bad = 0
items = 0
for row in lines:
    assert row["id"] not in held, f"held-out row {row['id']} exported"
    sysm, user, asst = row["messages"]
    assert (sysm["role"], user["role"], asst["role"]) == ("system", "user", "assistant")
    parts = [p for p in user["content"] if p["type"] == "image_url"]
    assert len(parts) == 8 and [p["image_url"]["url"] for p in parts] == row["images"]
    for p in parts:
        name = p["image_url"]["url"]
        head = tar.extractfile(members[name]).read(8)
        if head != b"\x89PNG\r\n\x1a\n":
            bad += 1
    answer = json.loads(asst["content"])
    asked = len(re.findall(r"^\d+\. ", sysm["content"], re.M))
    assert len(answer["checklist"]) == asked, (row["id"], asked, len(answer["checklist"]))
    for c in answer["checklist"]:
        assert isinstance(c["pass"], bool) and c["detail"].strip() and not c["detail"].startswith("[2x zoom]"), c
    items += asked
assert items == manifest["counts"]["items"], (items, manifest["counts"]["items"])
print(json.dumps({"samples": len(lines), "items": items, "images": sum(1 for n in members if n.startswith("images/")), "badPng": bad,
                  "heldOut": len(held), "counts": manifest["counts"], "cap": manifest["cap"], "instrument": manifest["instrumentId"]}))
