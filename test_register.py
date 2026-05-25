import requests, json, sys

url = 'http://127.0.0.1:5000/api/v1/auth/register'
payload = {
    "name": "Test User",
    "email": "testuser@example.com",
    "password": "TestPass123!",
    "document_type": "CC",
    "document_number": "123456",
    "phone": "3001234567"
}

response = requests.post(url, json=payload)
print('Status:', response.status_code)
print('Response:', response.text)
