import os
import io
import tempfile
import zipfile
import logging
import threading
import shutil
from datetime import datetime
from urllib.parse import quote
from flask import Flask, request, send_file, jsonify, url_for
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from flask_socketio import SocketIO, emit
import yt_dlp

# Setup Flask
app = Flask(__name__, static_folder='static')
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{os.path.join(BASE_DIR, "downloads.db")}'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SECRET_KEY'] = 'your-secret-key-here'
CORS(app)
db = SQLAlchemy(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# Setup logging
logging.basicConfig(level=logging.INFO)

# Database model
class DownloadHistory(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    url = db.Column(db.String(500), nullable=False)
    title = db.Column(db.String(500))
    file_format = db.Column(db.String(10), nullable=False)
    quality = db.Column(db.String(20))
    file_size = db.Column(db.String(20))
    download_path = db.Column(db.String(500))
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    status = db.Column(db.String(20), default='completed')

    def as_dict(self):
        return {
            'id': self.id,
            'url': self.url,
            'title': self.title,
            'file_format': self.file_format,
            'quality': self.quality,
            'file_size': self.file_size,
            'download_path': self.download_path,
            'timestamp': self.timestamp.isoformat() + 'Z',
            'status': self.status
        }

with app.app_context():
    db.create_all()

# Progress hook for real-time updates
def progress_hook(d, download_id):
    if d['status'] == 'downloading':
        percent = d.get('_percent_str', '0%').strip()
        speed = d.get('_speed_str', 'N/A').strip()
        eta = d.get('_eta_str', 'N/A').strip()
        downloaded = d.get('_downloaded_bytes_str', '0B').strip()
        total = d.get('_total_bytes_str', 'Unknown').strip()
        
        socketio.emit('download_progress', {
            'download_id': download_id,
            'percent': percent,
            'speed': speed,
            'eta': eta,
            'downloaded': downloaded,
            'total': total,
            'status': 'Downloading'
        })
    elif d['status'] == 'finished':
        socketio.emit('download_progress', {
            'download_id': download_id,
            'percent': '100%',
            'status': 'Processing...'
        })
    elif d['status'] == 'error':
        socketio.emit('download_error', {
            'download_id': download_id,
            'error': d.get('error', 'Unknown error')
        })

def download_single(url, file_format, quality, output_path, download_id):
    """Enhanced download function with quality options"""
    try:
        # Common options
        base_opts = {
            'outtmpl': os.path.join(output_path, '%(title)s.%(ext)s'),
            'progress_hooks': [lambda d: progress_hook(d, download_id)],
            'quiet': False,
            'no_warnings': False,
            'nocheckcertificate': True,
            'http_headers': {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'
            },
            'retries': 10,
            'fragment_retries': 10,
            'continuedl': True
        }

        # Quality settings for video
        quality_formats = {
            '2160p': 'bestvideo[height<=2160]+bestaudio/best',
            '1440p': 'bestvideo[height<=1440]+bestaudio/best',
            '1080p': 'bestvideo[height<=1080]+bestaudio/best',
            '720p': 'bestvideo[height<=720]+bestaudio/best',
            '480p': 'bestvideo[height<=480]+bestaudio/best',
            '360p': 'bestvideo[height<=360]+bestaudio/best',
            'best': 'bestvideo+bestaudio/best'
        }
        
        # Audio quality settings
        audio_quality = {
            '320kbps': '320',
            '256kbps': '256',
            '192kbps': '192',
            '128kbps': '128',
            'best': '0'
        }
        
        if file_format == 'mp4':
            format_str = quality_formats.get(quality, 'bestvideo+bestaudio/best')
            ydl_opts = {
                **base_opts,
                'format': format_str,
                'merge_output_format': 'mp4'
            }
            
        elif file_format == 'mp3':
            quality_val = audio_quality.get(quality, '192')
            ydl_opts = {
                **base_opts,
                'format': 'bestaudio/best',
                'postprocessors': [{
                    'key': 'FFmpegExtractAudio',
                    'preferredcodec': 'mp3',
                    'preferredquality': quality_val,
                }]
            }
            
        elif file_format == 'wav':
            ydl_opts = {
                **base_opts,
                'format': 'bestaudio/best',
                'postprocessors': [{
                    'key': 'FFmpegExtractAudio',
                    'preferredcodec': 'wav',
                }]
            }
            
        elif file_format in ['jpg', 'png']:
            thumbnail_format = 'jpg' if file_format == 'jpg' else 'png'
            ydl_opts = {
                **base_opts,
                'skip_download': True,
                'writethumbnail': True,
                'postprocessors': [{
                    'key': 'FFmpegThumbnailsConvertor',
                    'preferedformat': thumbnail_format
                }]
            }
        else:
            raise ValueError('Unsupported format')

        # Extract info and download
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            title = info.get('title', 'Unknown')
            
            # Get final file path reliably
            if file_format in ['jpg', 'png']:
                # Thumbnail path
                thumbnail = info.get('thumbnails', [{}])[-1].get('filepath')
                if thumbnail and os.path.exists(thumbnail):
                    final_path = thumbnail
                else:
                    raise FileNotFoundError('Thumbnail not found')
            else:
                # Main download path
                requested_downloads = info.get('requested_downloads', [])
                if requested_downloads:
                    final_path = requested_downloads[0].get('filepath')
                else:
                    raise FileNotFoundError('Downloaded file not found')
            
            if not os.path.exists(final_path):
                raise FileNotFoundError('File not found after download')
            
            file_size = os.path.getsize(final_path)
            file_size_mb = f"{file_size / (1024*1024):.2f} MB"
            
            return {
                'path': final_path,
                'title': title,
                'size': file_size_mb
            }
            
    except Exception as e:
        logging.error(f"Download error for {url}: {str(e)}")
        socketio.emit('download_error', {
            'download_id': download_id,
            'error': str(e)
        })
        raise

@app.route('/')
def index():
    return app.send_static_file('index.html')

@app.route('/download_file')
def download_file():
    path = request.args.get('path')
    if not path or not os.path.exists(path):
        return jsonify({'error': 'File not found'}), 404
    filename = os.path.basename(path)
    response = send_file(path, as_attachment=True, download_name=filename)
    # Optional: Cleanup temp after send (uncomment if needed)
    # threading.Thread(target=shutil.rmtree, args=(os.path.dirname(path),)).start()
    return response

@app.route('/download', methods=['POST'])
def download():
    data = request.get_json()
    urls_input = data.get('urls', [])
    file_format = data.get('format')
    quality = data.get('quality')
    custom_path = data.get('path', '')
    
    if not urls_input or not file_format:
        return jsonify({'error': 'Missing required parameters'}), 400
    
    # Use custom path or temp directory
    if custom_path and os.path.exists(custom_path) and os.path.isdir(custom_path):
        output_path = custom_path
        is_temp = False
    else:
        output_path = tempfile.mkdtemp(prefix='just_paste_')
        is_temp = True
    
    results = []
    errors = []
    
    # Use threads for concurrent downloads
    threads = []
    lock = threading.Lock()
    
    def threaded_download(idx, url):
        download_id = f"download_{idx}_{datetime.now().timestamp()}"
        try:
            result = download_single(url, file_format, quality, output_path, download_id)
            
            # Wrap DB operations in app context
            with app.app_context():
                # Save to history
                record = DownloadHistory(
                    url=url,
                    title=result['title'],
                    file_format=file_format,
                    quality=quality,
                    file_size=result['size'],
                    download_path=result['path'],
                    status='completed'
                )
                db.session.add(record)
                db.session.commit()
                
                results.append({
                    'url': url,
                    'title': result['title'],
                    'path': result['path'],
                    'size': result['size']
                })
            
            socketio.emit('download_complete', {
                'download_id': download_id,
                'title': result['title'],
                'path': result['path']
            })
            
        except Exception as e:
            with app.app_context():
                errors.append({'url': url, 'error': str(e)})
            logging.error(f"Error downloading {url}: {str(e)}")
    
    try:
        for idx, url in enumerate(urls_input):
            t = threading.Thread(target=threaded_download, args=(idx, url))
            threads.append(t)
            t.start()
        
        # Wait for all threads to complete
        for t in threads:
            t.join()
        
        # Prepare response
        response_data = {
            'success': len(errors) == 0,
            'results': results,
            'errors': errors
        }
        
        if len(results) > 0 and is_temp:
            if len(results) > 1:
                zip_filename = f"just_paste_downloads_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
                zip_path = os.path.join(output_path, zip_filename)
                with zipfile.ZipFile(zip_path, 'w') as zf:
                    for res in results:
                        arcname = f"{res['title'].replace('/', '_').replace('\\', '_')}.{file_format}"
                        zf.write(res['path'], arcname=arcname)
                response_data['download_type'] = 'zip'
                response_data['download_url'] = f"/download_file?path={quote(zip_path)}"
            else:
                response_data['download_type'] = 'single'
                response_data['download_url'] = f"/download_file?path={quote(results[0]['path'])}"
        elif custom_path:
            response_data['path'] = output_path
        
        return jsonify(response_data)
        
    except Exception as e:
        logging.exception("Download batch error")
        return jsonify({'error': str(e)}), 500

@app.route('/history', methods=['GET'])
def history():
    records = DownloadHistory.query.order_by(DownloadHistory.timestamp.desc()).limit(100).all()
    return jsonify([r.as_dict() for r in records])

@app.route('/clear_history', methods=['POST'])
def clear_history():
    try:
        db.session.query(DownloadHistory).delete()
        db.session.commit()
        return jsonify({'status': 'History cleared'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@app.route('/delete_history/<int:record_id>', methods=['DELETE'])
def delete_history(record_id):
    record = DownloadHistory.query.get(record_id)
    if not record:
        return jsonify({'error': 'Record not found'}), 404
    try:
        db.session.delete(record)
        db.session.commit()
        return jsonify({'status': 'Record deleted'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@app.route('/validate_path', methods=['POST'])
def validate_path():
    data = request.get_json()
    path = data.get('path', '')
    
    if os.path.exists(path) and os.path.isdir(path):
        return jsonify({'valid': True, 'message': 'Path is valid'})
    else:
        return jsonify({'valid': False, 'message': 'Path does not exist or is not a directory'})

if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)