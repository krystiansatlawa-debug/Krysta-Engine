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

## Naprawa ustawień

- Walidacja i automatyczne odzyskiwanie ustawień czterech modułów: Krysta Cloud, FPS, aktualizator launchera oraz monitor aktualizacji gier.
- Zapis ostatniej poprawnej wersji do lokalnej kopii .bak; zachowanie uszkodzonego pliku .corrupt-\* przed odzyskaniem.
- W przypadku braku poprawnej kopii uszkodzone ustawienia modułu są odtwarzane z bezpiecznych wartości domyślnych.
- Ręczne sprawdzanie i raport w Ustawienia > Ogólne > Naprawa ustawień Krysty.
- Mechanizm nie naprawia całej bazy LevelDB, nie usuwa biblioteki, historii aktualizacji, tokenów kont ani zapisów gier. Dodano testy regresji uruchamiane przed publikacją Windows.

## Synchronizacja bazowa Hydry w aplikacji

- Ustawienia aktualizacji pokazują oddzielnie numer pakietu bazowego Hydry i najnowsze stabilne wydanie bazowe. Numer pakietu jest informacją kompilacji, a nie dowodem pełnej zgodności kodu.
- Status przygotowania integracji jest pobierany przez publiczne API GitHub; jeśli status workflow nie jest dostępny, aplikacja pozostaje w stanie oczekiwania zamiast zgadywać wynik.
- GitHub sprawdza nowe wydania bazowe co sześć godzin. Kompilacja testowa kandydata obejmuje testy odzyskiwania ustawień i środowisko tłumaczeń Krysty.
- Klient nie zawiera tokenu zapisu GitHuba i nie instaluje binariów Hydry. Po sprawdzeniu, zatwierdzeniu zmian i publikacji nowego wydania Krysty użytkownik otrzymuje aktualizację w aplikacji.
- Konflikty integracji i publikacja wymagają weryfikacji projektu. Nie ma automatycznego scalania do main ani automatycznej publikacji niesprawdzonej Hydry.
