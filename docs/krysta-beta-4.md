# Krysta Launcher 1.0.0 Beta 4

- Ubisoft Connect: eksperymentalny odczyt własnych zdobytych i zablokowanych osiągnięć przez połączone konto, osobna zakładka w szczegółach gry, automatyczne odświeżanie widocznej zakładki. Niepubliczny interfejs może odmówić dostępu; brak testu na realnym koncie. Osiągnięcia pozostają oddzielone od Steam i nie są wysyłane do Hydra Cloud.

- Ustawienia nagrywania znajdują się w sekcji Zrzuty ekranu; osobna zakładka Nagrania na górnym pasku służy do przeglądania i zarządzania klipami.
- Nagrania Windows: opt-in, bufor w pamięci do 30 s przed osiągnięciem, 5–60 s po nim, ręczny skrót, 720p/1080p/1440p i 30/60 FPS jako maksymalne parametry, opcjonalny dźwięk systemowy, limit miejsca bez automatycznego usuwania, wybór folderu, filtrowanie po grze, miniatury i odtwarzacz w aplikacji. Bufor używa do dwóch nakładających się nagrań WebM; faktyczny czas przed zdarzeniem zależy od gotowości bufora. Nagrywanie zatrzymuje się przy utracie fokusu. Automatyczny wybór zgłaszanego energooszczędnego enkodera (jeśli obsługiwany), sprawdzanie wolnego miejsca przed nagrywaniem, przycinanie z zapisem osobnej kopii oraz odczyt plików binarnych bez Base64. Brak gwarancji akceleracji sprzętowej; wymagane testy nagrywania, eksportu i dźwięku na Windows.

- Wersja lokalna gry odczytywana jest automatycznie po otwarciu zakładki aktualizacji i zmianie ścieżki EXE; informacje o patchach odświeżają się bez ręcznego klikania. Gdy brak numeru wersji, wyświetlany jest rozpoznany identyfikator kompilacji platformy (Build ID), o ile dostępny.

- Do instalatora i wersji portable Windows dołączono zweryfikowany PresentMon 2.3.1 (x64). Licznik FPS automatycznie wykrywa dołączone narzędzie; ręczny wybór pozostaje opcjonalny. Pomiar wymaga zgodności z konfiguracją Windows i grą.

- Kopie zapisów przed aktualizacją gier są zapisywane i weryfikowane lokalnie, niezależnie od połączenia z Google Drive, Synology lub Hydra Cloud.
- Gdy Ludusavi nie wykryje plików zapisów, ręczne otwarcie kolejki Steam pozwala wybrać kontynuowanie bez kopii lub anulowanie. Automatyczne aktualizacje pozostają zablokowane, jeśli nie uda się wykonać kopii.
- Błędy kopiowania i weryfikacji nadal blokują aktualizację.
- W ustawieniach Krysta Cloud można otworzyć folder lokalnych kopii przed aktualizacją. Te kopie są również uwzględniane przez interfejs listy i przywracania zapisów Krysty.
- Zawiera poprawki Google OAuth z Beta 3: diagnostykę 401 i lokalny import pliku JSON klienta Desktop.

Jedynie pliki zapisów wykryte przez Ludusavi są kopiowane; zachowanie zapisów rejestru i nieobsługiwanych ścieżek nie jest gwarantowane. Kolejka Steam pozostaje kontrolowana przez Steam. Wymagany test aktualizacji i przywracania zapisów na Windows.
