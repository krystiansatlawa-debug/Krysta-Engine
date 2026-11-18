# Krysta Launcher 1.0.1

Aktualizacja funkcjonalności i stabilności wersji Windows (instalator i portable).

## Co nowego

- Prostszy górny pasek: **Nagrania**, **Zrzuty ekranu** i **Gry z nowymi patchami**. Biblioteka, Pobieranie i Ustawienia pozostają w menu bocznym.
- Wspólna galeria własnych screenshotów i lokalnych pamiątek osiągnięć, z filtrowaniem i pełnoekranowym podglądem. Pamiątki osiągnięć są funkcją opcjonalną, mogą wymagać aktywnej subskrypcji.
- Uproszczone Ustawienia z wyszukiwarką kategorii i ukrytymi opcjami zaawansowanymi.
- Automatyczne wykrywanie pliku startowego `.exe` dla rozpoznanych lokalnych gier Windows. Bez nadpisywania wyboru ręcznego lub integracji Steam/Epic; niepewne dopasowania wymagają zatwierdzenia.
- Monitor aktualizacji gier: historia patchy, postęp sprawdzania, oddzielenie ogłoszeń patchy od potwierdzonych aktualizacji Steam/Epic/GOG.

## Google Drive / Krysta Cloud

- Prostszy przycisk logowania, ponowne wykorzystanie poprawnej konfiguracji OAuth Desktop i test połączenia Google.
- Diagnostyka błędów `invalid_client`, `invalid_grant`, `unauthorized_client` i braku dostępu.
- Jeśli konfiguracji Google Desktop OAuth nie dołączono do instalatora, pierwsze połączenie wymaga jednorazowego wybrania pliku JSON klienta Desktop z Google Cloud; po udanym logowaniu konfiguracja jest przechowywana lokalnie.
- Logowanie przez przeglądarkę z PKCE i lokalnym adresem powrotnym, bez podawania hasła Google w Krysta Launcher.

## Uwagi

- Do wydania dołączono plik sum kontrolnych SHA-256.
- Weryfikacja kont Google, Ubisoft i obsługi EXE wymaga testu na rzeczywistym komputerze Windows. Poprawny klient OAuth oraz dostęp do Google Drive API pozostają niezbędne.
