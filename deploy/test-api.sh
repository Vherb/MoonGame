#!/bin/bash
# Test API endpoints

echo "=== Testing /api/rooms ==="
curl -s http://127.0.0.1:6000/api/rooms
echo

echo "=== Testing /api/ping ==="
curl -s http://127.0.0.1:6000/api/ping
echo

echo "=== Testing /api/models ==="
curl -s http://127.0.0.1:6000/api/models | head -c 100
echo

echo "=== Testing /api/sounds ==="
curl -s http://127.0.0.1:6000/api/sounds | head -c 100
echo

echo "=== Testing /api/registration ==="
curl -s -X POST http://127.0.0.1:6000/api/registration \
  -H 'Content-Type: application/json' \
  -d '{"email":"apitest@test.com","username":"apitest99","password":"test1234"}'
echo

echo "=== Testing /api/login ==="
curl -s -X POST http://127.0.0.1:6000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"apitest99","password":"test1234"}'
echo

echo "=== Testing via nginx /api/rooms ==="
curl -sk https://moongame.atspace.cc/api/rooms
echo

echo "=== Done ==="
