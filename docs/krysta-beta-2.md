# Krysta Launcher 1.0.0 Beta 2

- Przywrócono konfigurację logowania Google Drive w kompilacji Windows.
- Dodano kontrolę obecności konfiguracji klienta OAuth przed kompilacją.
- Pozostałe funkcje z Beta 1 pozostają dostępne.

Logowanie Google wymaga klienta typu Desktop app i uprawnionego konta Google. Aplikacja desktopowa jest klientem publicznym; identyfikator i sekret tego klienta można odczytać z instalatora. Tokeny użytkowników nie są dystrybuowane. Wydanie eksperymentalne, niepodpisane; wymaga testów logowania i synchronizacji.

## Aktualizator Krysty

- Automatyczne wykrywanie i pobieranie nowszych wydań Krysty, w tym kolejnych bet, wyłącznie z Krysta-Engine.
- Pasek postępu na górze programu i w ustawieniach aktualizacji.
- Weryfikacja rozmiaru oraz SHA-256 z metadanych GitHub Releases przed udostępnieniem instalatora i ponownie przed otwarciem.
- Instalacja tylko po kliknięciu użytkownika i gdy launcher nie śledzi uruchomionych gier. Windows x64 w wersji zainstalowanej; Portable pozostaje przy pobieraniu ręcznym.
- Brak podpisu cyfrowego instalatora: hash potwierdza zgodność z plikiem na GitHubie, nie zastępuje podpisu wydawcy.

Beta 1 wymaga jednorazowego ręcznego przejścia na Beta 2. Test aktualizacji między wydaniami jest wymagany przed uznaniem mechanizmu za gotowy.
