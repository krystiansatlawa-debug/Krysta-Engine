# Krysta Launcher 1.0.0 Beta 4

- Do instalatora i wersji portable Windows dołączono zweryfikowany PresentMon 2.3.1 (x64). Licznik FPS automatycznie wykrywa dołączone narzędzie; ręczny wybór pozostaje opcjonalny. Pomiar wymaga zgodności z konfiguracją Windows i grą.

- Kopie zapisów przed aktualizacją gier są zapisywane i weryfikowane lokalnie, niezależnie od połączenia z Google Drive, Synology lub Hydra Cloud.
- Gdy Ludusavi nie wykryje plików zapisów, ręczne otwarcie kolejki Steam pozwala wybrać kontynuowanie bez kopii lub anulowanie. Automatyczne aktualizacje pozostają zablokowane, jeśli nie uda się wykonać kopii.
- Błędy kopiowania i weryfikacji nadal blokują aktualizację.
- W ustawieniach Krysta Cloud można otworzyć folder lokalnych kopii przed aktualizacją. Te kopie są również uwzględniane przez interfejs listy i przywracania zapisów Krysty.
- Zawiera poprawki Google OAuth z Beta 3: diagnostykę 401 i lokalny import pliku JSON klienta Desktop.

Jedynie pliki zapisów wykryte przez Ludusavi są kopiowane; zachowanie zapisów rejestru i nieobsługiwanych ścieżek nie jest gwarantowane. Kolejka Steam pozostaje kontrolowana przez Steam. Wymagany test aktualizacji i przywracania zapisów na Windows.
