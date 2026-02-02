import asyncio
import os
import sys
import json
import argparse
from twikit import Client
from dotenv import load_dotenv

# Carregar variáveis de ambiente do .env
load_dotenv()

COOKIES_FILE = 'cookies.json'

async def main():
    parser = argparse.ArgumentParser(description='Twitter Poster Service')
    parser.add_argument('--text', type=str, help='Text content of the tweet')
    parser.add_argument('--media', type=str, help='Path to media file')
    args = parser.parse_args()

    # Configurar cliente com User-Agent de navegador real para evitar flag de automação
    client = Client(
        language='en-US',
        user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' 
    )

    # Tenta carregar cookies, senão faz login
    login_needed = True
    if os.path.exists(COOKIES_FILE):
        try:
            client.load_cookies(COOKIES_FILE)
            login_needed = False
        except Exception:
            login_needed = True

    if login_needed:
        username = os.getenv('TWITTER_USERNAME')
        password = os.getenv('TWITTER_PASSWORD')
        email = os.getenv('TWITTER_EMAIL')
        
        if not username or not password:
            print(json.dumps({"success": False, "error": "Credenciais TWITTER_USERNAME ou TWITTER_PASSWORD faltando no .env"}))
            return

        try:
            # Login inicial
            await client.login(
                auth_info_1=username,
                auth_info_2=email,
                password=password
            )
            client.save_cookies(COOKIES_FILE)
        except Exception as e:
             print(json.dumps({"success": False, "error": f"Falha no login: {str(e)}"}))
             return

    # Preparar mídia
    media_ids = []
    if args.media:
        if not os.path.exists(args.media):
            print(json.dumps({"success": False, "error": f"Arquivo de mídia não encontrado: {args.media}"}))
            return
        
        try:
            # Upload da mídia
            media_id = await client.upload_media(args.media)
            media_ids.append(media_id)
        except Exception as e:
            print(json.dumps({"success": False, "error": f"Erro upload media: {str(e)}"}))
            return

    # Postar Tweet
    try:
        tweet = await client.create_tweet(
            text=args.text if args.text else '',
            media_ids=media_ids if media_ids else None
        )
        print(json.dumps({"success": True, "id": tweet.id}))
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Erro ao postar: {str(e)}"}))

if __name__ == "__main__":
    asyncio.run(main())
