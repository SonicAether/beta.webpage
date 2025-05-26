document.addEventListener('DOMContentLoaded', function() {
    const galleries = document.querySelectorAll('.image-gallery');

    galleries.forEach(gallery => {
        const imageWrappers = Array.from(gallery.querySelectorAll('.image-wrapper'));
        const images = imageWrappers.map(wrapper => wrapper.querySelector('img')).filter(img => img !== null);

        if (images.length === 0) return;

        // Warten, bis alle Bilder in dieser Galerie geladen sind
        const promises = images.map(img => {
            return new Promise((resolve, reject) => {
                if (img.complete) {
                    resolve(img);
                } else {
                    img.onload = () => resolve(img);
                    img.onerror = () => reject(new Error(`Bild konnte nicht geladen werden: ${img.src}`));
                }
            });
        });

        Promise.all(promises)
            .then(loadedImages => {
                let landscapeCount = 0;
                let portraitCount = 0;
                const wrapperData = []; // Speichert Infos zu jedem Wrapper

                imageWrappers.forEach(wrapper => {
                    const img = wrapper.querySelector('img');
                    if (img && loadedImages.includes(img)) { // Nur verarbeiten, wenn Bild geladen wurde
                        const isLandscape = img.naturalWidth > img.naturalHeight;
                        if (isLandscape) {
                            landscapeCount++;
                        } else {
                            portraitCount++;
                        }
                        wrapperData.push({ element: wrapper, isLandscape: isLandscape });
                    }
                });

                const totalImages = wrapperData.length;
                const gapValue = gallery.style.gap ? parseFloat(gallery.style.gap) : 10; // Standard-Gap, falls nicht anders gesetzt
                const gapHalf = `${gapValue / 2}px`;

                // Logik anwenden
                if (totalImages === 1) {
                    // 1. Ein Bild -> volle Breite
                    wrapperData[0].element.style.flexBasis = '100%';
                } else {
                    // Mehr als ein Bild
                    if (portraitCount === 2 && landscapeCount === 0 && totalImages === 2) {
                        // 2. Genau zwei Bilder UND beide Hochformat -> nebeneinander
                        wrapperData.forEach(data => {
                            data.element.style.flexBasis = `calc(50% - ${gapHalf})`;
                        });
                    } else {
                        // 3. Alle anderen Fälle (Querformate, gemischte Formate, mehr/weniger als 2 Hochformate)
                        wrapperData.forEach(data => {
                            if (data.isLandscape) {
                                // Querformat immer untereinander (volle Breite)
                                data.element.style.flexBasis = '100%';
                            } else {
                                // Hochformat:
                                // Wenn es Querformate gibt ODER es nicht genau 2 Hochformatbilder sind, dann untereinander.
                                // Der Fall "genau 2 Hochformatbilder alleine" wurde oben abgedeckt.
                                // Spezifischer Fall: 1 Querformat, 2 Hochformatbilder -> Querformat 100%, Hochformate darunter nebeneinander.
                                if (landscapeCount > 0 && portraitCount === 2 && wrapperData.filter(wd => !wd.isLandscape).includes(data)) {
                                     data.element.style.flexBasis = `calc(50% - ${gapHalf})`;
                                } else {
                                     data.element.style.flexBasis = '100%';
                                }
                            }
                        });
                    }
                }
            })
            .catch(error => {
                console.error("Fehler beim Laden der Bilder in einer Galerie:", error);
            });
    });
});
