# Тексты для App Store Connect

Скопируйте в соответствующие поля. В скобках указан лимит символов.

## Карточка приложения

**Название** (30): Team Tracker GPS

**Подзаголовок** (30): Групповой трекер GPS

**Категория:** основная — Навигация, дополнительная — Спорт

**Промо‑текст** (170):
Треки всей группы на одной карте: свежие — красные, старые — зелёные. Для грибников, поисковых отрядов и туристов. Трек пишется в кармане, работает без интернета.

**Описание** (4000):
Team Tracker GPS — групповой GPS‑трекер. Каждый выход на природу записывается как широкая цветная полоса на карте. Цвет показывает, как давно здесь прошли: красный — только что, жёлтый — недавно, зелёный — давно. Сразу видно, какая территория уже пройдена, а куда давно никто не заходил.

Три готовых профиля — у каждого своя общая карта и свои настройки:
• Грибники — полоса 7 м, трек зеленеет за 3 дня и исчезает на 4‑й: грибы успели подрасти.
• Волонтёры‑поисковики — полоса 30 м показывает осмотренную территорию, через сутки зеленеет и становится прозрачнее.
• Пешие туристы — маршруты за 3 месяца, родники, стоянки и виды.

Свои группы: создайте группу с названием, аватаркой и описанием, задайте ширину полосы, скорость «старения» трека, срок показа, требования к точности GPS и порог скорости. Участники вступают по коду и видят только треки своей группы.

• Запись трека с выключенным экраном: телефон в кармане, трек пишется.
• На машине не пишет: при скорости выше порога группы точки не записываются.
• Неточные точки GPS отбрасываются.
• Нажмите на полосу — узнаете, кто и когда здесь проходил.
• Метки с фото и описанием: «Для всех» (видит группа) или «Для меня» (только в телефоне).
• Топокарта (тропы, просеки, рельеф) и спутниковые снимки, скачивание района для работы без интернета.
• Рейтинг группы: баллы за пройденные километры и полезные метки.
• Выгрузка трека с метками в GPX.
• Без регистрации по телефону и почте — только ник и фото.

Приложение не заменяет средства связи и спасения. В экстренной ситуации звоните 112.

Карты: © участники OpenStreetMap, OpenTopoMap (CC‑BY‑SA); снимки © Esri.

**Ключевые слова** (100, через запятую без пробелов):
трекер,gps,группа,трек,карта,грибы,поиск,поисковик,туризм,поход,офлайн,метки,лес,маршрут

**URL поддержки:** https://ВАШ_ЛОГИН.github.io/team-tracker-gps/terms.html
**URL политики конфиденциальности:** https://ВАШ_ЛОГИН.github.io/team-tracker-gps/privacy.html
**Авторские права:** 2026 Ваше имя

## Конфиденциальность приложения (App Privacy)

«Собираете ли вы данные?» — **Да**. Для каждого типа: цель **App Functionality (функциональность приложения)**, **Linked to the user (связаны с пользователем)** — да, **Used for tracking (отслеживание)** — **нет**.

| Раздел в анкете | Тип | Почему |
|---|---|---|
| Location | **Precise Location** | точки трека и места меток |
| User Content | **Photos or Videos** | фото профиля, аватарки групп, фото меток |
| User Content | **Other User Content** | ник, описания меток и групп, жалобы |
| Identifiers | **User ID** | случайный ID аккаунта |

Всё остальное (контакты, здоровье, покупки, поисковая история, диагностика, реклама) — **не собирается**.

## Возрастной рейтинг

В анкете всё «Нет/None», кроме:
- **User‑Generated Content** — **Да** (метки, фото, ники и группы других пользователей с модерацией).

## Шифрование (Export Compliance)

Уже указано в приложении (`ITSAppUsesNonExemptEncryption = NO`): используется только стандартный HTTPS.

## Заметки для проверяющего (App Review Information → Notes)

Вставьте по‑английски:

```
Team Tracker GPS is a group GPS tracker for outdoor activities (mushroom pickers, search-and-rescue volunteers, hikers). The UI is in Russian.

No login is required: on first launch the user enters only a nickname (optional photo), accepts the community rules and picks a profile. No demo account is needed.

HOW TO TEST
1. Enter any nickname, tick the rules checkbox, tap "Далее" (Next).
2. Pick a profile, e.g. "Пешие туристы" (Hikers). Each profile is a separate shared map; the round button under the map-layers button (top right) switches groups, creates a new group ("Создать группу") or joins one by code ("Вступить по коду").
3. Tap "Начать запись трека" (Start recording). The track is drawn as a wide coloured band: red = fresh, green = older. Points are not recorded above the group's speed limit (e.g. in a car) or with poor GPS accuracy.
4. Tap the yellow pin button (right side) to add a mark with photo and description; save it "Для всех" (visible to the group) or "Для меня" (private, stored only on device).
5. Tap "Закончить запись" (Stop) to see the summary and export GPX.

BACKGROUND LOCATION
Background location is used only while the user is recording a track (between "Начать запись трека" and "Закончить запись"), so the track keeps recording while the phone is in a pocket with the screen off. The blue location indicator is shown. Location is not collected when not recording.

USER-GENERATED CONTENT (Guideline 1.2)
- Users must accept community rules (terms.html) before use.
- Obscene words in nicknames and descriptions of other users are filtered; obscene nicknames and group names are rejected.
- Report: open any other user's mark -> "Пожаловаться" (Report); in the group members list tap the flag ⚑ next to a user.
- Block: open any other user's mark -> "Скрыть этого участника" (Hide this user), or toggle the user off in the members list.
- Reports are stored in our database and reviewed within 24 hours; offending content is removed.
- Contact: see Support URL.

ACCOUNT DELETION (Guideline 5.1.1(v))
Settings (gear icon) -> "Аккаунт и данные" -> "Удалить аккаунт" deletes the profile, all tracks, public marks and group memberships from the server immediately.
```
