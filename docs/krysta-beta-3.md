# Krysta Launcher 1.0.0 Beta 3

## Google Drive OAuth

- Rozpoznawanie błędów klienta OAuth (401), nieważnego kodu i niedozwolonego typu klienta bez ujawniania tokenów lub danych uwierzytelniających.
- Usuwanie zbędnych spacji z identyfikatora i sekretu wbudowanego klienta Desktop.
- Awaryjne logowanie przy użyciu lokalnego pliku JSON klienta OAuth typu Desktop, pobranego z Google Cloud Console. Plik nie jest przesyłany na GitHub. Dane udanego logowania pozostają w zaszyfrowanym magazynie Krysty.
- Błędny sekret wbudowanego klienta nadal wymaga poprawnej konfiguracji Google Cloud i GitHub Actions. Nie ma obejścia nieprawidłowej autoryzacji Google.

Test logowania na rzeczywistym koncie Google pozostaje wymagany.
