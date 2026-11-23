# CodeMentor

## Uruchomienie lokalne

1. Zainstaluj Node.js 20 lub nowszy.
2. W PowerShell skopiuj `.env.example` do `.env` poleceniem `Copy-Item .env.example .env`, a następnie wpisz swój klucz Groq jako `GROQ_API_KEY`.
3. Uruchom `npm start`.
4. Otwórz `http://localhost:3000`.

Nie otwieraj `index.html` bezpośrednio z dysku — czat łączy się z backendem przez `/api/chat`.

## Publikacja na Render

1. Umieść projekt w prywatnym repozytorium GitHub. Nigdy nie dodawaj pliku `.env` ani klucza API do repozytorium.
2. W Render wybierz **New + → Blueprint** i wskaż repozytorium. Render odczyta konfigurację z `render.yaml`.
3. W ustawieniach usługi dodaj sekret `GROQ_API_KEY` z panelu Groq i uruchom wdrożenie.
4. Otwórz publiczny adres usługi Render. Endpoint `/healthz` służy do sprawdzania stanu aplikacji.

Backend przechowuje klucz Groq po stronie serwera. Publiczne demo ma podstawowy limit 10 zapytań na minutę z jednego adresu IP; przy udostępnianiu większej liczbie osób skonfiguruj dodatkowe limity kosztów po stronie Groq i zabezpieczenia hostingu.
