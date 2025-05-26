document.addEventListener('DOMContentLoaded', function() {
    const galleries = document.querySelectorAll('.image-gallery');

    galleries.forEach(gallery => {
        const imageWrappers = Array.from(gallery.querySelectorAll('.image-wrapper'));
        // Sorge dafür, dass nur Wrapper mit img-Tags weiterverarbeitet werden
        const validImageWrappers = imageWrappers.filter(wrapper => wrapper.querySelector('img'));

        if (validImageWrappers.length === 0) {
            // console.log("Keine gültigen Image Wrapper in Galerie gefunden:", gallery);
            return;
        }

        const promises = validImageWrappers.map(wrapper => {
            const img = wrapper.querySelector('img');
            return new Promise((resolve) => { // Immer resolven, um Promise.all nicht zu blockieren
                if (img.complete && img.naturalHeight > 0 && img.naturalWidth > 0) {
                    resolve({ wrapper, img, status: 'loaded' });
                } else {
                    img.onload = () => {
                        if (img.naturalHeight > 0 && img.naturalWidth > 0) {
                            resolve({ wrapper, img, status: 'loaded' });
                        } else {
                            // console.warn(`Bild geladen, aber ungültige Dimensionen: ${img.src}`);
                            resolve({ wrapper, img, status: 'error_dimensions' });
                        }
                    };
                    img.onerror = () => {
                        // console.warn(`Bild konnte nicht geladen werden: ${img.src}`);
                        resolve({ wrapper, img, status: 'error_load' });
                    };
                }
            });
        });

        Promise.all(promises)
            .then(results => {
                // Nur erfolgreich geladene Bilder mit validen Dimensionen verwenden
                const successfulResults = results.filter(r => r.status === 'loaded');
                
                if (successfulResults.length === 0) {
                    // console.log("Keine Bilder erfolgreich geladen in Galerie:", gallery);
                    // Reset auf CSS-Standard für alle Wrapper in dieser Galerie, falls Bilder fehlschlagen
                    validImageWrappers.forEach(vw => {
                        vw.style.flexBasis = ''; // Lässt CSS-Standard greifen
                        vw.style.paddingTop = ''; // Lässt CSS-Standard greifen
                    });
                    return;
                }

                const wrapperData = successfulResults.map(r => ({
                    element: r.wrapper,
                    imgElement: r.img,
                    isLandscape: r.img.naturalWidth > r.img.naturalHeight,
                    naturalWidth: r.img.naturalWidth,
                    naturalHeight: r.img.naturalHeight
                }));

                const landscapeCount = wrapperData.filter(d => d.isLandscape).length;
                const portraitCount = wrapperData.filter(d => !d.isLandscape).length;
                const totalImages = wrapperData.length; // Anzahl der erfolgreich geladenen Bilder

                // Gap-Wert aus CSS holen oder Standardwert verwenden
                let gapValue = 10; // Default
                const galleryGapStyle = getComputedStyle(gallery).gap;
                if (galleryGapStyle && galleryGapStyle !== 'normal') { // 'normal' ist der Default-Wert, wenn nicht gesetzt
                    gapValue = parseFloat(galleryGapStyle);
                }
                const gapHalf = `${gapValue / 2}px`;


                // Standard-Padding-Tops für Konsistenz
                const defaultLandscapePaddingTop = '75%'; // für 4:3 Querformat
                const defaultPortraitPairPaddingTop = '133.33%'; // für 3:4 Hochformat-Paare (kann angepasst werden)

                // --- Logik zur Anordnung und Seitendarstellung ---

                // Fall 1: Nur ein Bild in der Galerie
                if (totalImages === 1) {
                    const item = wrapperData[0];
                    item.element.style.flexBasis = '100%';
                    if (item.isLandscape) {
                        // Bei einem einzelnen Querformatbild kann man auch das exakte Verhältnis nehmen
                        // oder einen Standard für Konsistenz, wenn die Bilder leicht variieren.
                        // Hier exaktes Verhältnis:
                        const aspectRatio = (item.naturalHeight / item.naturalWidth) * 100;
                        item.element.style.paddingTop = `${aspectRatio}%`;
                        // Oder Standard: item.element.style.paddingTop = defaultLandscapePaddingTop;
                    } else { // Hochformat
                        const aspectRatio = (item.naturalHeight / item.naturalWidth) * 100;
                        item.element.style.paddingTop = `${aspectRatio}%`;
                    }
                    return; // Verarbeitung für diese Galerie abgeschlossen
                }

                // Fall 2: Genau zwei Hochformatbilder und KEINE Querformatbilder
                if (portraitCount === 2 && landscapeCount === 0 && totalImages === 2) {
                    wrapperData.forEach(item => {
                        item.element.style.flexBasis = `calc(50% - ${gapHalf})`;
                        // Für nebeneinanderliegende Hochformatbilder einen konsistenten Padding-Top:
                        item.element.style.paddingTop = defaultPortraitPairPaddingTop;
                    });
                    return;
                }
                
                // Fall 3: Mindestens ein Querformatbild UND genau zwei Hochformatbilder
                // Querformat(e) oben volle Breite, die zwei Hochformate darunter nebeneinander.
                if (landscapeCount > 0 && portraitCount === 2) {
                    wrapperData.forEach(item => {
                        if (item.isLandscape) {
                            item.element.style.flexBasis = '100%';
                            const aspectRatio = (item.naturalHeight / item.naturalWidth) * 100;
                            item.element.style.paddingTop = `${aspectRatio}%`;
                            // Oder Standard: item.element.style.paddingTop = defaultLandscapePaddingTop;
                        } else { // Hochformatbild (es gibt genau zwei davon)
                            item.element.style.flexBasis = `calc(50% - ${gapHalf})`;
                            item.element.style.paddingTop = defaultPortraitPairPaddingTop;
                        }
                    });
                    return;
                }

                // Fall 4: Alle anderen Konstellationen
                // (z.B. nur Querformatbilder > 1, oder 1Q+1H, oder 3+ Hochformat, etc.)
                // Hier wird jedes Bild einzeln untereinander mit seinem passenden Seitenverhältnis dargestellt.
                wrapperData.forEach(item => {
                    item.element.style.flexBasis = '100%';
                    if (item.isLandscape) {
                        const aspectRatio = (item.naturalHeight / item.naturalWidth) * 100;
                        item.element.style.paddingTop = `${aspectRatio}%`;
                        // Oder Standard: item.element.style.paddingTop = defaultLandscapePaddingTop;
                    } else { // Hochformat
                        const aspectRatio = (item.naturalHeight / item.naturalWidth) * 100;
                        item.element.style.paddingTop = `${aspectRatio}%`;
                    }
                });

            })
            .catch(error => {
                console.error("Fehler bei der globalen Verarbeitung der Bildgalerie (Promise.all):", error);
            });
    });
});
