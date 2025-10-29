from flask import Flask, jsonify, request
import os, time, random

# Import the generator from the project root
import sys
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)
from crossWord import generate_puzzle_payload  # type: ignore

app = Flask(__name__)

@app.route('/api/crossWord', methods=['GET'])
def handle_request():
    try:
        payload = generate_puzzle_payload()
        # Add a simple puzzleId similar to Node path
        ts = time.strftime('%Y-%m-%dT%H-%M-%S', time.gmtime())
        pid = f"{ts}-{random.randint(100000,999999)}"
        return jsonify({
            'puzzleId': pid,
            'output': '',
            'myStringUnedited': payload['myStringUnedited'],
            'answerArrayFlat': payload['answerArrayFlat'],
            'legend': payload['legend'],
            'userAnswers': None
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# No app.run() needed; Vercel's Python runtime attaches the handler.
