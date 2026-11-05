document.addEventListener("DOMContentLoaded", async function () {
    const calendarGrid = document.getElementById("calendarGrid");
    const monthTitle = document.getElementById("currentMonth");
    const previousButton = document.getElementById("prevMonth");
    const nextButton = document.getElementById("nextMonth");
    const todayButton = document.getElementById("todayButton");
    const weekdayHeader = document.querySelector(".calendar-weekdays");
    const calendarViewButtons = document.querySelectorAll(
        "[data-calendar-view]"
    );
    const calendarStatus = document.getElementById("calendarStatus");
    const calendarItemDialog = document.getElementById("calendarItemDialog");
    const calendarItemForm = document.getElementById("calendarItemForm");
    const calendarItemType = document.getElementById("calendarItemType");
    const calendarItemTitle = document.getElementById("calendarItemTitle");
    const calendarItemDate = document.getElementById("calendarItemDate");
    const calendarItemTime = document.getElementById("calendarItemTime");
    const appointmentTimeField = document.getElementById(
        "appointmentTimeField"
    );
    const today = new Date();
    const itemsByKind = {
        note: document.getElementById("notesList"),
        reminder: document.getElementById("remindersList"),
        task: document.getElementById("taskList"),
        event: document.getElementById("eventList")
    };
    const itemKinds = ["note", "reminder", "task", "event", "appointment"];
    const profileButton = document.getElementById("profileButton");
    const profileDropdown = document.getElementById("profileDropdown");
    const philippineHolidayCache = new Map();
    let items = [];
    let calendarView = "month";
    let displayedDate = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate()
    );

    function setStatus(message) {
        if (calendarStatus) {
            calendarStatus.textContent = message;
        }
    }

    async function request(url, options) {
        const response = await fetch(url, {
            credentials: "same-origin",
            ...options,
            headers: {
                ...(options && options.headers),
                ...(options && options.body
                    ? { "Content-Type": "application/json" }
                    : {})
            }
        });

        if (!response.ok) {
            let message = "Request failed (" + response.status + ").";

            if (response.status === 401) {
                window.location.href = "login.html";
            } else {
                try {
                    const result = await response.json();
                    message = result.message || result.detail || result.title ||
                        message;
                } catch (error) {
                    console.error(
                        "Could not read the API error response.",
                        error
                    );
                }
            }

            const error = new Error(message);
            error.status = response.status;
            throw error;
        }

        if (response.status === 204) {
            return null;
        }

        return response.json();
    }

    function getDateKey(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return year + "-" + month + "-" + day;
    }

    function getWeekStart(date) {
        const start = new Date(
            date.getFullYear(),
            date.getMonth(),
            date.getDate()
        );
        start.setDate(start.getDate() - start.getDay());
        return start;
    }

    function getEasterSunday(year) {
        const a = year % 19;
        const b = Math.floor(year / 100);
        const c = year % 100;
        const d = Math.floor(b / 4);
        const e = b % 4;
        const f = Math.floor((b + 8) / 25);
        const g = Math.floor((b - f + 1) / 3);
        const h = (19 * a + b - d - g + 15) % 30;
        const i = Math.floor(c / 4);
        const k = c % 4;
        const l = (32 + 2 * e + 2 * i - h - k) % 7;
        const m = Math.floor((a + 11 * h + 22 * l) / 451);
        const month = Math.floor((h + l - 7 * m + 114) / 31);
        const day = ((h + l - 7 * m + 114) % 31) + 1;

        return new Date(year, month - 1, day);
    }

    function getPhilippineHolidays(year) {
        if (philippineHolidayCache.has(year)) {
            return philippineHolidayCache.get(year);
        }

        const holidays = new Map();
        const addHoliday = function (date, name) {
            holidays.set(getDateKey(date), name);
        };
        const easterSunday = getEasterSunday(year);
        const maundyThursday = new Date(easterSunday);
        maundyThursday.setDate(maundyThursday.getDate() - 3);
        const goodFriday = new Date(easterSunday);
        goodFriday.setDate(goodFriday.getDate() - 2);

        addHoliday(new Date(year, 0, 1), "New Year's Day");
        addHoliday(new Date(year, 3, 9), "Araw ng Kagitingan");
        addHoliday(maundyThursday, "Maundy Thursday");
        addHoliday(goodFriday, "Good Friday");
        addHoliday(new Date(year, 4, 1), "Labor Day");
        addHoliday(new Date(year, 5, 12), "Independence Day");
        addHoliday(new Date(year, 7, 21), "Ninoy Aquino Day");

        const lastAugustDay = new Date(year, 7, 31);
        const daysAfterMonday = (lastAugustDay.getDay() + 6) % 7;
        lastAugustDay.setDate(lastAugustDay.getDate() - daysAfterMonday);
        addHoliday(lastAugustDay, "National Heroes Day");

        addHoliday(new Date(year, 10, 1), "All Saints' Day");
        addHoliday(new Date(year, 10, 30), "Bonifacio Day");
        addHoliday(new Date(year, 11, 8), "Feast of the Immaculate Conception");
        addHoliday(new Date(year, 11, 24), "Christmas Eve");
        addHoliday(new Date(year, 11, 25), "Christmas Day");
        addHoliday(new Date(year, 11, 30), "Rizal Day");
        addHoliday(new Date(year, 11, 31), "Last Day of the Year");

        philippineHolidayCache.set(year, holidays);
        return holidays;
    }

    function formatDate(dateString) {
        if (!dateString) {
            return "";
        }

        return new Date(dateString + "T00:00:00").toLocaleDateString();
    }

    async function saveItem(item) {
        try {
            const updated = await request(
                item.id ? "/api/items/" + item.id : "/api/items",
                {
                    method: item.id ? "PUT" : "POST",
                    body: JSON.stringify(item)
                }
            );

            if (item.id) {
                items = items.map(existing =>
                    existing.id === item.id ? updated : existing
                );
            } else {
                items.push(updated);
            }

            setStatus("");
            renderAll();
            return true;
        } catch (error) {
            setStatus(error.message);
            console.error("Could not save dashboard item.", error);
            return false;
        }
    }

    async function removeItem(item) {
        if (!confirm("Delete this " + item.kind + "?")) {
            return;
        }

        try {
            await request("/api/items/" + item.id, { method: "DELETE" });
            items = items.filter(existing => existing.id !== item.id);
            setStatus("");
            renderAll();
        } catch (error) {
            setStatus(error.message);
            console.error("Could not delete dashboard item.", error);
        }
    }

    function createItemRow(item, location) {
        const row = document.createElement("div");
        row.className = item.kind + "-item";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = item.completed;
        checkbox.setAttribute(
            "aria-label",
            "Mark " + item.title + " as complete"
        );
        checkbox.addEventListener("change", function () {
            saveItem({ ...item, completed: checkbox.checked });
        });

        let content;
        if (item.kind === "task") {
            const color = document.createElement("span");
            color.className = "task-color blue-dot";
            row.appendChild(checkbox);
            row.appendChild(color);

            content = document.createElement("span");
            content.className = "task-content";
        } else if (item.kind === "event" || item.kind === "appointment") {
            row.appendChild(checkbox);
            content = document.createElement("span");
        } else {
            content = document.createElement("div");
            if (item.kind === "reminder") {
                const dot = document.createElement("span");
                dot.className = "priority-dot blue-dot";
                row.appendChild(dot);
            }
        }

        const title = document.createElement("strong");
        title.textContent = item.title;
        content.appendChild(title);

        if (item.details) {
            const details = document.createElement(
                item.kind === "task" ? "small" : "p"
            );
            details.textContent = item.details;
            content.appendChild(details);
        }

        if (item.date || item.time) {
            const dateTime = document.createElement("small");
            dateTime.textContent = [
                formatDate(item.date),
                item.time
            ].filter(Boolean).join(" · ");
            content.appendChild(dateTime);
        }

        row.appendChild(content);

        const actions = document.createElement("div");
        actions.className = "item-actions";

        const editButton = document.createElement("button");
        editButton.type = "button";
        editButton.className = "edit-button";
        editButton.textContent = "Edit";
        editButton.addEventListener("click", async function () {
            const titleText = prompt("Edit " + item.kind + " title:", item.title);
            if (titleText === null || !titleText.trim()) {
                return;
            }

            let detailsText = item.details;
            if (item.kind === "note") {
                detailsText = prompt("Edit note details:", item.details);
                if (detailsText === null) {
                    return;
                }
            }

            await saveItem({
                ...item,
                title: titleText.trim(),
                details: detailsText
            });
        });

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "delete-button";
        deleteButton.textContent = "Delete";
        deleteButton.addEventListener("click", function () {
            removeItem(item);
        });

        actions.appendChild(editButton);
        actions.appendChild(deleteButton);
        row.appendChild(actions);

        if (item.completed) {
            row.classList.add("completed");
        }

        if (location === "calendar") {
            row.classList.add("calendar-item");
            const type = document.createElement("span");
            type.className = "calendar-item-type";
            type.textContent = item.kind;
            content.insertBefore(type, title);
        }

        return row;
    }

    function renderLists() {
        Object.values(itemsByKind).forEach(function (list) {
            if (list) {
                list.replaceChildren();
            }
        });

        items.forEach(function (item) {
            if (item.kind === "task") {
                if (!item.date || item.date === getDateKey(today)) {
                    itemsByKind.task?.appendChild(createItemRow(item, "list"));
                }
            } else if (item.kind === "event" || item.kind === "appointment") {
                itemsByKind.event?.appendChild(createItemRow(item, "list"));
            } else {
                itemsByKind[item.kind]?.appendChild(createItemRow(item, "list"));
            }
        });
    }

    function updateCalendarViewButtons() {
        calendarViewButtons.forEach(function (button) {
            const isActive = button.dataset.calendarView === calendarView;
            button.classList.toggle("active", isActive);
            button.setAttribute("aria-pressed", String(isActive));
        });
    }

    function createCalendarDayCell(cellDate, isMuted) {
        const dayKey = getDateKey(cellDate);
        const dayCell = document.createElement("div");
        dayCell.className = "calendar-day";

        if (isMuted) {
            dayCell.classList.add("muted");
        }

        const dayHeader = document.createElement("div");
        dayHeader.className = "calendar-day-header";
        const dayLabel = document.createElement("span");
        dayLabel.className = "calendar-day-date";
        dayLabel.textContent = cellDate.getDate();
        dayHeader.appendChild(dayLabel);
        dayCell.appendChild(dayHeader);

        if (dayKey === getDateKey(today)) {
            dayCell.classList.add("today");
            dayCell.setAttribute("aria-current", "date");
        }

        const holidayName = getPhilippineHolidays(
            cellDate.getFullYear()
        ).get(dayKey);

        if (holidayName) {
            const holidayLabel = document.createElement("span");
            holidayLabel.className = "calendar-holiday";
            holidayLabel.textContent = holidayName;
            holidayLabel.title = "Philippine holiday: " + holidayName;
            holidayLabel.setAttribute("role", "note");
            dayCell.appendChild(holidayLabel);
        }

        const dayItems = items.filter(item =>
            item.date === dayKey &&
            ["task", "event", "appointment"].includes(item.kind)
        );

        if (dayItems.length > 0) {
            const itemList = document.createElement("div");
            itemList.className = "calendar-items";
            itemList.tabIndex = 0;
            itemList.setAttribute(
                "aria-label",
                "Events, tasks, and appointments for " +
                    cellDate.toLocaleDateString()
            );

            dayItems.forEach(function (item) {
                itemList.appendChild(createItemRow(item, "calendar"));
            });

            dayCell.appendChild(itemList);
        }

        return dayCell;
    }

    function renderYear() {
        const year = displayedDate.getFullYear();

        for (let month = 0; month < 12; month++) {
            const monthCard = document.createElement("section");
            monthCard.className = "calendar-year-month";

            const monthHeading = document.createElement("h2");
            monthHeading.textContent = new Date(year, month, 1)
                .toLocaleDateString("en-US", { month: "long" });
            monthCard.appendChild(monthHeading);

            const monthWeekdays = document.createElement("div");
            monthWeekdays.className = "calendar-year-weekdays";
            ["S", "M", "T", "W", "T", "F", "S"].forEach(function (label) {
                const weekday = document.createElement("span");
                weekday.textContent = label;
                monthWeekdays.appendChild(weekday);
            });
            monthCard.appendChild(monthWeekdays);

            const monthGrid = document.createElement("div");
            monthGrid.className = "calendar-year-grid";
            const firstDay = new Date(year, month, 1).getDay();
            const totalDays = new Date(year, month + 1, 0).getDate();

            for (let index = 0; index < 42; index++) {
                let cellDate;
                let isMuted = false;

                if (index < firstDay) {
                    cellDate = new Date(
                        year,
                        month - 1,
                        new Date(year, month, 0).getDate() - firstDay + index + 1
                    );
                    isMuted = true;
                } else if (index >= firstDay + totalDays) {
                    cellDate = new Date(
                        year,
                        month + 1,
                        index - firstDay - totalDays + 1
                    );
                    isMuted = true;
                } else {
                    cellDate = new Date(year, month, index - firstDay + 1);
                }

                const cellKey = getDateKey(cellDate);
                const holidayName = getPhilippineHolidays(
                    cellDate.getFullYear()
                ).get(cellKey);
                const hasItems = items.some(item =>
                    item.date === cellKey &&
                    ["task", "event", "appointment"].includes(item.kind)
                );
                const dateButton = document.createElement("button");
                dateButton.type = "button";
                dateButton.className = "calendar-year-day";
                dateButton.textContent = cellDate.getDate();

                if (isMuted) {
                    dateButton.classList.add("muted");
                }
                if (cellDate.getFullYear() === year && holidayName) {
                    dateButton.classList.add("has-holiday");
                }
                if (cellDate.getFullYear() === year && hasItems) {
                    dateButton.classList.add("has-items");
                }
                if (cellKey === getDateKey(today)) {
                    dateButton.classList.add("today");
                    dateButton.setAttribute("aria-current", "date");
                }

                const labels = [
                    cellDate.toLocaleDateString(),
                    holidayName,
                    hasItems ? "Calendar items" : ""
                ].filter(Boolean);
                dateButton.title = labels.join(" - ");
                dateButton.setAttribute("aria-label", labels.join(", "));
                dateButton.addEventListener("click", function () {
                    displayedDate = new Date(
                        cellDate.getFullYear(),
                        cellDate.getMonth(),
                        cellDate.getDate()
                    );
                    calendarView = "day";
                    updateCalendarViewButtons();
                    renderCalendar();
                });
                monthGrid.appendChild(dateButton);
            }

            monthCard.appendChild(monthGrid);
            calendarGrid.appendChild(monthCard);
        }
    }

    function renderCalendar() {
        if (!calendarGrid || !monthTitle) {
            return;
        }

        const year = displayedDate.getFullYear();
        const month = displayedDate.getMonth();
        calendarGrid.replaceChildren();
        calendarGrid.classList.remove(
            "view-day",
            "view-week",
            "view-month",
            "view-year"
        );
        calendarGrid.classList.add("view-" + calendarView);
        weekdayHeader.hidden = calendarView === "day" || calendarView === "year";

        if (calendarView === "year") {
            monthTitle.textContent = String(year);
            renderYear();
            return;
        }

        let startDate;
        let numberOfDays;

        if (calendarView === "day") {
            monthTitle.textContent = displayedDate.toLocaleDateString(
                "en-US",
                { weekday: "long", month: "long", day: "numeric", year: "numeric" }
            );
            startDate = new Date(year, month, displayedDate.getDate());
            numberOfDays = 1;
        } else if (calendarView === "week") {
            startDate = getWeekStart(displayedDate);
            const weekEnd = new Date(startDate);
            weekEnd.setDate(weekEnd.getDate() + 6);
            monthTitle.textContent =
                startDate.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric"
                }) +
                " – " +
                weekEnd.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric"
                });
            numberOfDays = 7;
        } else {
            monthTitle.textContent = displayedDate.toLocaleDateString(
                "en-US",
                { month: "long", year: "numeric" }
            );
            startDate = new Date(year, month, 1 - new Date(year, month, 1).getDay());
            numberOfDays = 42;
        }

        for (let index = 0; index < numberOfDays; index++) {
            const cellDate = new Date(startDate);
            cellDate.setDate(startDate.getDate() + index);
            const isMuted = calendarView === "month" &&
                cellDate.getMonth() !== month;
            calendarGrid.appendChild(
                createCalendarDayCell(cellDate, isMuted)
            );
        }
    }

    function renderAll() {
        renderLists();
        renderCalendar();
    }

    function openItemDialog(kind, date) {
        if (!calendarItemDialog || !calendarItemForm) {
            return;
        }

        calendarItemForm.reset();
        calendarItemType.value = kind || "task";
        calendarItemDate.value = getDateKey(date || today);
        appointmentTimeField.hidden =
            calendarItemType.value !== "appointment";
        calendarItemDialog.showModal();
        calendarItemTitle.focus();
    }

    async function loadDashboard() {
        try {
            const user = await request("/api/auth/me");
            const profileName = document.getElementById("profileName");
            const profileEmail = document.getElementById("profileEmail");
            const profileInitial = document.getElementById("profileInitial");

            if (profileName) {
                profileName.textContent = user.fullName;
            }
            if (profileEmail) {
                profileEmail.textContent = user.email;
            }
            if (profileInitial) {
                profileInitial.textContent =
                    (user.fullName || user.email || "U").charAt(0).toUpperCase();
            }

            try {
                const storedAccounts = JSON.parse(
                    localStorage.getItem("dolisAccounts") || "[]"
                );
                const accounts = Array.isArray(storedAccounts)
                    ? storedAccounts.filter(account => typeof account === "string")
                    : [];
                const email = user.email.toLowerCase();

                localStorage.setItem(
                    "dolisAccounts",
                    JSON.stringify([
                        email,
                        ...accounts.filter(account => account !== email)
                    ].slice(0, 5))
                );
            } catch (error) {
                console.warn(
                    "Could not remember this account on this browser.",
                    error
                );
            }

            const loadedItems = await request("/api/items");
            items = loadedItems.filter(item =>
                item && itemKinds.includes(item.kind) &&
                typeof item.id === "string" &&
                typeof item.title === "string"
            );
            renderAll();
        } catch (error) {
            if (error.status === 401) {
                return;
            }

            setStatus(error.message);
            console.error("Could not load dashboard data.", error);
        }
    }

    const addCalendarItemButton = document.getElementById("addCalendarItem");
    addCalendarItemButton?.addEventListener("click", function () {
        openItemDialog("task", today);
    });

    calendarItemType?.addEventListener("change", function () {
        appointmentTimeField.hidden =
            calendarItemType.value !== "appointment";
    });

    calendarItemForm?.addEventListener("submit", async function (event) {
        event.preventDefault();
        const title = calendarItemTitle.value.trim();
        if (!title) {
            calendarItemTitle.focus();
            return;
        }

        const kind = calendarItemType.value;
        const saved = await saveItem({
            kind,
            title,
            details: "",
            date: calendarItemDate.value || null,
            time: kind === "appointment" && calendarItemTime.value
                ? calendarItemTime.value
                : null,
            completed: false
        });

        if (saved) {
            calendarItemDialog.close();
        }
    });

    document.getElementById("cancelCalendarItem")?.addEventListener(
        "click",
        function () {
            calendarItemDialog.close();
        }
    );

    previousButton?.addEventListener("click", function () {
        if (calendarView === "day") {
            displayedDate.setDate(displayedDate.getDate() - 1);
        } else if (calendarView === "week") {
            displayedDate.setDate(displayedDate.getDate() - 7);
        } else if (calendarView === "year") {
            displayedDate.setDate(1);
            displayedDate.setFullYear(displayedDate.getFullYear() - 1);
        } else {
            displayedDate.setDate(1);
            displayedDate.setMonth(displayedDate.getMonth() - 1);
        }
        renderCalendar();
    });

    nextButton?.addEventListener("click", function () {
        if (calendarView === "day") {
            displayedDate.setDate(displayedDate.getDate() + 1);
        } else if (calendarView === "week") {
            displayedDate.setDate(displayedDate.getDate() + 7);
        } else if (calendarView === "year") {
            displayedDate.setDate(1);
            displayedDate.setFullYear(displayedDate.getFullYear() + 1);
        } else {
            displayedDate.setDate(1);
            displayedDate.setMonth(displayedDate.getMonth() + 1);
        }
        renderCalendar();
    });

    todayButton?.addEventListener("click", function () {
        displayedDate = new Date();
        renderCalendar();
    });

    calendarViewButtons.forEach(function (button) {
        button.addEventListener("click", function () {
            calendarView = button.dataset.calendarView;
            updateCalendarViewButtons();
            renderCalendar();
        });
    });

    document.getElementById("addTask")?.addEventListener("click", function () {
        openItemDialog("task", today);
    });

    document.getElementById("addEvent")?.addEventListener("click", function () {
        openItemDialog("event", today);
    });

    document.getElementById("addNote")?.addEventListener("click", async function () {
        const title = prompt("Enter a title for your note:");
        if (title === null || !title.trim()) {
            return;
        }

        const details = prompt("Enter your note:");
        if (details === null) {
            return;
        }

        await saveItem({
            kind: "note",
            title: title.trim(),
            details: details.trim(),
            date: null,
            time: null,
            completed: false
        });
    });

    document.getElementById("addReminder")?.addEventListener(
        "click",
        async function () {
            const title = prompt("Enter your reminder:");
            if (title === null || !title.trim()) {
                return;
            }

            await saveItem({
                kind: "reminder",
                title: title.trim(),
                details: "",
                date: null,
                time: null,
                completed: false
            });
        }
    );

    function setProfileMenuOpen(open) {
        if (!profileButton || !profileDropdown) {
            return;
        }

        profileDropdown.hidden = !open;
        profileButton.setAttribute("aria-expanded", String(open));
    }

    profileButton?.addEventListener("click", function () {
        setProfileMenuOpen(profileDropdown.hidden);
    });

    document.addEventListener("click", function (event) {
        if (
            profileDropdown &&
            !profileDropdown.hidden &&
            !profileDropdown.contains(event.target) &&
            !profileButton.contains(event.target)
        ) {
            setProfileMenuOpen(false);
        }
    });

    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
            setProfileMenuOpen(false);
        }
    });

    async function leaveCurrentAccount(destination) {
        try {
            await request("/api/auth/logout", { method: "POST" });
            window.location.href = destination;
        } catch (error) {
            setStatus(error.message);
            console.error("Could not leave the current account.", error);
        }
    }

    document.getElementById("switchAccountButton")?.addEventListener(
        "click",
        function () {
            leaveCurrentAccount("login.html?switch=1");
        }
    );

    document.getElementById("addAccountButton")?.addEventListener(
        "click",
        function () {
            leaveCurrentAccount("register.html?add=1");
        }
    );

    document.getElementById("logoutButton")?.addEventListener(
        "click",
        function () {
            leaveCurrentAccount("login.html");
        }
    );

    await loadDashboard();
});
