/*---------------------------------------------
        Template name:  JAGO
        Version:        1.0
        Author:         Mindwhile IT Solutions
        Author url:     https://Mindwhile IT Solutions.com/

NOTE:
------
Please DO NOT EDIT THIS JS, you may need to use "custom.js" file for writing your custom js.
We may release future updates, so it will overwrite this file. it's better and safer to use "custom.js".

[Table of Content]

    01: Main Menu
    02: Background Image
    03: Check Data
    04: Changing SVG Color
    05: Preloader
    06: currentYear
    07: Perfect Scrollbar
    08: Dark, Light & RTL Switcher
    09: Settings Toggle
    10: Menu Active Page
    11: File Upload
    12: Multiple file upload
    11: Countdown Timer
    12: Magnific Popup
    13: Enable Tooltip
    14: Circular Progress
    15: Show Color Code
----------------------------------------------*/

(function ($) {
    ("use strict");

    /*==================
  01: Main Menu
  =======================*/

    /* Parent li add class */
    let body = $("body");
    $(".aside .aside-body")
        .find("ul li")
        .parents(".aside-body ul li")
        .addClass("has-sub-item");

    /* Submenu Opened */
    $(".aside .aside-body")
        .find(".has-sub-item > a")
        .on("click", function (event) {
            event.preventDefault();
            if (!body.hasClass("aside-folded")) {
                let $submenu = $(this).siblings("ul");
                let $parentItem = $(this).parent(".has-sub-item");

                $parentItem.toggleClass("sub-menu-opened");
                if ($submenu.hasClass("open")) {
                    // Closing the submenu
                    $submenu.removeClass("open").slideUp("200", function () {
                        adjustScrollAfterCollapse($submenu);
                    });
                } else {
                    // Opening the submenu
                    $submenu.addClass("open").slideDown("200", function () {
                        adjustScroll($submenu);
                    });
                }
            }
        });

    /* Function to adjust scroll to make the submenu fully visible */
    function adjustScroll($submenu) {
        let submenuRect = $submenu[0].getBoundingClientRect();
        let viewportHeight = $(window).height();
        let scrollContainer = $(".aside .aside-body")[0];

        // Check if the submenu is out of the viewport
        if (submenuRect.bottom > viewportHeight) {
            let scrollOffset = submenuRect.bottom - viewportHeight;
            scrollContainer.scrollTop += scrollOffset + 10;
        } else if (submenuRect.top < 0) {
            scrollContainer.scrollTop += submenuRect.top - 10;
        }
    }

    /* Function to adjust scroll after collapsing a submenu */
    function adjustScrollAfterCollapse($submenu) {
        let submenuRect = $submenu[0].getBoundingClientRect();
        let viewportHeight = $(window).height();
        let scrollContainer = $(".aside .aside-body")[0];

        // Check if the collapsed submenu is still affecting the viewport
        if (submenuRect.bottom > viewportHeight || submenuRect.top < 0) {
            scrollContainer.scrollTop -= submenuRect.height + 10;
        }
    }

    /* Activate Menu */
    function activateMenu($item) {
        // Add active class to the menu item
        $(".aside .aside-body .has-sub-item").removeClass("active");
        $item.addClass("active");

        // Call adjustScroll to ensure active item is visible
        let $submenu = $item.find("ul");
        if ($submenu.length) {
            adjustScroll($submenu);
        }
    }

    /* function to simulate menu activation */
    function simulateMenuActivation() {
        let $activeItem = $(".aside .aside-body .has-sub-item.active");
        activateMenu($activeItem);
    }

    // --- Tab Menu ---
    function checkNavOverflowTabs() {
        try {
            $(".nav--tab-wrapper .nav--tabs").each(function() {
                let $nav = $(this);
                let $btnNext = $nav.closest(".position-relative").find(".nav--tab__next");
                let $btnPrev = $nav.closest(".position-relative").find(".nav--tab__prev");

                let isRTL = $("html").attr("dir") === "rtl";

                let navScrollWidth = $nav[0].scrollWidth;
                let navClientWidth = $nav[0].clientWidth;
                let scrollLeft = Math.abs($nav.scrollLeft());

                let maxScrollLeft = navScrollWidth - navClientWidth;

                if (isRTL) {
                    let scrollRight = maxScrollLeft - scrollLeft;
                    $btnNext.toggle(scrollRight > 1);
                    $btnPrev.toggle(scrollLeft > 1);
                } else {
                    $btnNext.toggle(scrollLeft < maxScrollLeft - 1);
                    $btnPrev.toggle(scrollLeft > 1);
                }
            });
        } catch (error) {
            console.error(error);
        }
    }

    $(".nav--tab-wrapper .nav--tabs").each(function() {
        
        
        let $nav = $(this);
        let $activeItem = $nav.find(".nav-link.active");

        if ($activeItem.length) {
            let isRTL = $("html").attr("dir") === "rtl";
            let nav = $nav[0];
            let activeItem = $activeItem[0];

            let navRect = nav.getBoundingClientRect();
            let itemRect = activeItem.getBoundingClientRect();

            let offset = itemRect.left - navRect.left - 60;

            // nav.scrollLeft += offset;
            if (isRTL) {
                nav.scrollLeft -= offset;
            } else {
                nav.scrollLeft += offset;
            }


            checkNavOverflowTabs();
        }

        $nav.off("scroll").on("scroll", function () {
            checkNavOverflowTabs();
        });

        $nav.siblings(".nav--tab__next").on("click", function() {
            let scrollWidth = $nav.find("li").outerWidth(true);
            let isRTL = $("html").attr("dir") === "rtl";

            if (isRTL) {
                $nav.animate(
                    { scrollLeft: $nav.scrollLeft() - scrollWidth },
                    300,
                    function() {
                        checkNavOverflowTabs();
                    }
                );
            } else {
                $nav.animate(
                    { scrollLeft: $nav.scrollLeft() + scrollWidth },
                    300,
                    function() {
                        checkNavOverflowTabs();
                    }
                );
            }
        });

        $nav.siblings(".nav--tab__prev").on("click", function() {
            let scrollWidth = $nav.find("li").outerWidth(true);
            let isRTL = $("html").attr("dir") === "rtl";

            if (isRTL) {
                $nav.animate(
                    { scrollLeft: $nav.scrollLeft() + scrollWidth },
                    300,
                    function() {
                        checkNavOverflowTabs();
                    }
                );
            } else {
                $nav.animate(
                    { scrollLeft: $nav.scrollLeft() - scrollWidth },
                    300,
                    function() {
                        checkNavOverflowTabs();
                    }
                );
            }
        });
    });

    /* window resize trigger aside function */
    $(window).on("resize", function () {
        aside();
        checkNavOverflowTabs();
    });

    /* Aside function */
    function aside() {
        $(".aside-toggle").off("click");
        $(".offcanvas-overlay").off("click");

        if ($(window).width() > 1199) {
            
            /* Remove sidebar-open */
            body.removeClass("aside-open");

            /* Folded aside */
            $(".aside-toggle").on("click", function () {
                body.toggleClass("aside-folded");
                localStorage.setItem(
                    "isAsideFolded",
                    body.hasClass("aside-folded") ? "aside-folded" : ""
                );
                body.removeClass("aside-folded").addClass(localStorage.getItem("isAsideFolded"));

                body.find(".aside-body .has-sub-item a")
                    .siblings("ul")
                    .removeClass("open")
                    .slideUp("fast");

                setTimeout(checkNavOverflowTabs, 300);
            });
        } else {
            /* Remove aside folded */
            body.removeClass("aside-folded");
            /* Open Aside */
            $(".aside-toggle").on("click", function () {
                body.toggleClass("aside-open");
                $(".offcanvas-overlay").toggleClass("aside-active");

                setTimeout(checkNavOverflowTabs, 300);
            });
            $(".offcanvas-overlay").on("click", function () {
                body.removeClass("aside-open");
                $(".offcanvas-overlay").removeClass("aside-active");

                setTimeout(checkNavOverflowTabs, 300);
            });
            $(".offcanvas-overlay").removeClass("aside-active");
        }
    }

    aside();
    checkNavOverflowTabs();

    /* Folded Aside Function */
    function asideFoldedShowSubMenu() {
        $("body.aside-folded .aside-body .main-nav > .has-sub-item").on(
            "mouseenter",
            function () {
                let item = this.getBoundingClientRect();
                let subMenu = $(this).find("> .sub-menu");

                // Set the submenu position based on available space
                let subMenuHeight = subMenu.outerHeight();
                let availableSpaceBelow = window.innerHeight - item.bottom;

                if (availableSpaceBelow < subMenuHeight) {
                    subMenu
                        .css("inset-block-end", 0)
                        .css("inset-block-start", "auto");
                } else {
                    subMenu
                        .css("inset-block-start", item.y - 60)
                        .css("inset-block-end", "auto");
                }
            }
        );
    }

    $(".aside .aside-body").on("scroll", asideFoldedShowSubMenu);

    /* Active Menu Open */
    $(window).on("load", function () {
        $("body").addClass(localStorage.getItem("isAsideFolded"));

        asideFoldedShowSubMenu();

        $(".aside .aside-body")
            .find(".sub-menu-opened a")
            .siblings("ul")
            .addClass("open")
            .show();

        simulateMenuActivation(); // Simulate activation on load (can be removed or replaced with actual logic)
    });

    /*========================
  02: Background Image
  ==========================*/
    let $bgImg = $("[data-bg-img]");
    $bgImg
        .css("background-image", function () {
            return 'url("' + $(this).data("bg-img") + '")';
        })
        .removeAttr("data-bg-img")
        .addClass("bg-img");

    /*==================================
  03: Check Data
  ====================================*/
    let checkData = function (data, value) {
        return typeof data === "undefined" ? value : data;
    };

    /*==================================
  04: Changing svg color
  ====================================*/
    $(window).on("load", function () {
        $("img.svg").each(function () {
            let $img = jQuery(this);
            let imgID = $img.attr("id");
            let imgClass = $img.attr("class");
            let imgURL = $img.attr("src");

            jQuery.get(
                imgURL,
                function (data) {
                    // Get the SVG tag, ignore the rest
                    let $svg = jQuery(data).find("svg");

                    // Add replaced image's ID to the new SVG
                    if (typeof imgID !== "undefined") {
                        $svg = $svg.attr("id", imgID);
                    }
                    // Add replaced image's classes to the new SVG
                    if (typeof imgClass !== "undefined") {
                        $svg = $svg.attr("class", imgClass + " replaced-svg");
                    }

                    // Remove any invalid XML tags as per http://validator.w3.org
                    $svg = $svg.removeAttr("xmlns:a");

                    // Check if the viewport is set, else we're going to set it if we can.
                    if (
                        !$svg.attr("viewBox") &&
                        $svg.attr("height") &&
                        $svg.attr("width")
                    ) {
                        $svg.attr(
                            "viewBox",
                            "0 0 " +
                                $svg.attr("height") +
                                " " +
                                $svg.attr("width")
                        );
                    }

                    // Replace image with new SVG
                    $img.replaceWith($svg);
                },
                "xml"
            );
        });
    });

    /*==================================
  05: Preloader
  ====================================*/
    $(window).on("load", function () {
        $(".preloader").fadeOut(500);
    });

    /*==================================
  06: currentYear
  ====================================*/
    let currentYear = new Date().getFullYear();
    // $(".currentYear").html(currentYear);

    /*============================================
  07: Perfect Scrollbar
  ==============================================*/
    let $scrollBar = $('[data-trigger="scrollbar"]');
    if ($scrollBar.length) {
        $scrollBar.each(function () {
            let $ps, $pos;

            $ps = new PerfectScrollbar(this);

            $pos = localStorage.getItem("ps." + this.classList[0]);

            if ($pos !== null) {
                $ps.element.scrollTop = $pos;
            }
        });

        $scrollBar.on("ps-scroll-y", function () {
            localStorage.setItem("ps." + this.classList[0], this.scrollTop);
        });
    }

    /*============================================
  08: Dark, Light & RTL Switcher
  ==============================================*/
    function themeSwitcher(className, themeName) {
        $(className).on("click", function () {
            $(".setting-box").removeClass("active");
            $(this).addClass("active");
            $("body").attr("theme", themeName);
            localStorage.setItem("theme", themeName);
        });
    }

    themeSwitcher(".setting-box.light-mode", "light");
    themeSwitcher(".setting-box.dark-mode", "dark");

    function rtlSwitcher(className, dirName) {
        $(className).on("click", function () {
            $(".setting-box").removeClass("active");
            $(this).addClass("active");
            $("html").attr("dir", dirName);
            localStorage.setItem("dir", dirName);
        });
    }

    rtlSwitcher(".setting-box.ltr-mode", "ltr");
    rtlSwitcher(".setting-box.rtl-mode", "rtl");

    $(window).on("load", function () {
        $("body").attr("theme", localStorage.getItem("theme"));
        // $('html').attr('dir', localStorage.getItem("dir"));
    });

    /*============================================
  09: Settings Toggle
  ==============================================*/
    $(document).ready(function () {
        $(document).on("click", ".settings-toggle-icon", function (e) {
            e.stopPropagation();
            $(".settings-sidebar").toggleClass("active");
        });
        $(document).on("click", "body", function (e) {
            if (!$(e.target).is(".settings-sidebar, .settings-sidebar *"))
                $(".settings-sidebar").removeClass("active");
        });
    });

    /*============================================
  10: Menu Active Page
  ==============================================*/
    let current = location.pathname;
    let $path = current.substring(current.lastIndexOf("/") + 1);
    $(".aside-body .nav li a").each(function (e) {
        let $this = $(this);
        if ($path == $this.attr("href")) {
            $this.parent("li").addClass("active open");
            $this
                .parent("li")
                .parent("ul")
                .parent("li")
                .addClass("active sub-menu-opened");
        } else if ($path == "") {
            $(".aside-body .nav li:first-child").addClass("active open");
        }
    });

    /*============================================
  11: File Upload
  ==============================================*/

    /*============================================
 12: Multiple file upload
 ==============================================*/

    /*============================================
  13: Enable Tooltip
  ==============================================*/
    const tooltipTriggerList = document.querySelectorAll(
        '[data-bs-toggle="tooltip"]'
    );
    const tooltipList = [...tooltipTriggerList].map(
        (tooltipTriggerEl) => new bootstrap.Tooltip(tooltipTriggerEl)
    );

    /*============================================
  14: Circular Progress
  ==============================================*/
    $(".halfProgress").each(function () {
        let $bar = $(this).find(".bar");
        let $val = $(this).find("span");
        let perc = parseInt($val.text(), 10);

        $({ p: 0 }).animate(
            { p: perc },
            {
                duration: 3000,
                easing: "swing",
                step: function (p) {
                    $bar.css({
                        transform: "rotate(" + (45 + p * 1.8) + "deg)",
                    });
                    $val.text(p | 0);
                },
            }
        );
    });

    $(".circle-progress").each(function () {
        if ($(this).attr("data-parsent")) {
            $(this).css("background", function () {
                return (
                    "conic-gradient(" +
                    ($(this).attr("data-color")
                        ? $(this).data("color")
                        : "#2563EB") +
                    " " +
                    $(this).data("parsent") +
                    "%, transparent 0)"
                );
            });
            $(this).find(".persent").css("color", $(this).attr("data-color"));
        }
    });

    /*============================================
  15: Show Color Code
  ==============================================*/
    $(document).on("change", ".form-control_color", function () {
        $(this).closest(".form-group").find(".color_code").text($(this).val());
    });


    // ======= STATUS CHANGE GLOBALLY ======= //
    $(".table-column").click(function () {
        let column = "table ." + $(this).attr("name");
        $(column).toggle();
    });

    // $("#reset_btn").click(function () {
    //     $("#name").val(null);
    //
    //     lastpolygon.setMap(null);
    //     $("#coordinates").val(null);
    // });

    $(".search-submit").on("click", function () {
        setFilter(
            $(this).data("url"),
            document.getElementById("search").value,
            "search"
        );
    });
    $(".date-range-change").on("change", function () {
        setFilter(
            $(this).data("url"),
            document.getElementById("dateRange").value,
            "date_range"
        );
    });
    $(".date-range-submit").on("click", function () {
        setFilter(
            $(this).data("url"),
            document.getElementById("dateRange").value,
            "date_range"
        );
    });

    //Set Filter
    function setFilter(url, key, filter_by) {
        let fullUrl = new URL(url);
        fullUrl.searchParams.set(filter_by, key);
        location.href = fullUrl;
    }

    //collapsibleCard
    function collapsibleCard(thisInput) {
        let $card = thisInput.closest(".collapsible-card-body");
        let $content = $card.children(".collapsible-card-content");
        if (thisInput.attr("data-confirm-btn") === "Turn Off") {
            $content.slideDown();
        } else {
            $content.slideUp();
        }
    }

    function collapsibleCard2(thisInput) {
        let safetyViewCard = $(".safety_view-card");
        if (thisInput.attr("data-confirm-btn") === "Turn Off") {
            safetyViewCard.slideDown("fast");
        } else {
            safetyViewCard.slideUp("fast");
        }
    }

    $(".collapsible-card-switcher").on("change", function () {
        collapsibleCard($(this));
    });

    $(".collapsible-card-switcher2").on("change", function () {
        collapsibleCard2($(this));
    });
    $(".collapsible-card-switcher").each(function () {
        collapsibleCard($(this));
    });

    //Custom Slider Inside Menu
    function normalizeScrollLeft(el, isRTL) {
        // Normalize scrollLeft value for RTL
        if (!isRTL) return el.scrollLeft;
        // Handle different browser scroll behaviors
        const scrollLeft = el.scrollLeft;
        const scrollWidth = el.scrollWidth;
        const clientWidth = el.clientWidth;

        // Modern Chrome, Edge: returns negative scrollLeft
        if (scrollLeft < 0) {
            return scrollWidth + scrollLeft - clientWidth;
        }

        // Firefox: returns positive scrollLeft from right edge
        return scrollWidth - scrollLeft - clientWidth;
    }

    function scrollTo(el, distance, isRTL) {
        const current = normalizeScrollLeft(el[0], isRTL);
        const target = current + distance;

        // Convert to actual scrollLeft based on direction
        const actualScroll = isRTL ? el[0].scrollWidth - el[0].clientWidth - target : target;

        el.animate({ scrollLeft: actualScroll }, 300);
    }

    function checkNavOverflow($container = null) {
        try {
            const $targets = $container ? $container : $(".ride-progress-custop-wrap");

            $targets.each(function () {
                const $nav = $(this);
                const $btnNext = $nav.closest(".position-relative").find(".slide-cus__next");
                const $btnPrev = $nav.closest(".position-relative").find(".slide-cus__prev");

                const isRTL = $("html").attr("dir") === "rtl";
                const el = $nav[0];

                const scrollWidth = el.scrollWidth;
                const clientWidth = el.clientWidth;
                const currentScroll = normalizeScrollLeft(el, isRTL);

                const atStart = Math.floor(currentScroll) <= 1;
                const atEnd = Math.ceil(currentScroll + clientWidth) >= scrollWidth - 1;

                $btnPrev.toggle(!atStart);
                $btnNext.toggle(!atEnd);
            });
        } catch (err) {
            console.error("Scroll overflow check failed", err);
        }
    }

    $(window).on("load resize", function () {
        checkNavOverflow();
    });

    $(".ride-progress-custop-wrap").each(function () {
        const $nav = $(this);
        const isRTL = $("html").attr("dir") === "rtl";

        checkNavOverflow($nav);

        $nav.on("scroll", function () {
            checkNavOverflow($nav);
        });

        const scrollAmount = $nav.find(".w-250px").outerWidth(true) || 250;

        $nav.siblings(".slide-cus__next").on("click", function () {
            scrollTo($nav, scrollAmount, isRTL);
        });

        $nav.siblings(".slide-cus__prev").on("click", function () {
            scrollTo($nav, -scrollAmount, isRTL);
        });
    });

    //Keyborad tabs

    $(function () {
        function resetDefault() {
            // Reset wrappers
            $(".cmn_focus, .cmn_focus-shadow, .cmn_reset").removeClass("active").css({
                "outline": "",
                "box-shadow": "",
                "color": "",
                "background-color": ""
            });

            // Reset buttons
            $("button[type='reset']").css({
                "color": "",
                "outline": "",
                "box-shadow": ""
            });
            $("button[type='submit'], button[type='button']").css({
                "background-color": "",
                "outline": "",
                "box-shadow": ""
            });
        }

        function setActive(el) {
            resetDefault(); // always clean before applying

            let wrapper = el.closest(".cmn_focus, .cmn_focus-shadow, .cmn_reset");
            if (wrapper.length) {
                wrapper.addClass("active");
            }

            // Reset button styles
            if (el.is("button[type='reset']")) {
                el.css({
                    "color": "black",
                    "outline": "0.09px solid #2563EB",
                    "box-shadow": "0 0 5px rgba(0,0,0,0.5)"
                });
            }

            if (el.is("button[type='submit'], button[type='button']")) {
                el.css({
                    // "background-color": "#008a7aff",
                    "outline": "2px solid #1397d563",
                    "box-shadow": "0 0 5px rgba(148, 148, 148, 0.7)"
                });
            }
        }

        // On focus (tab or click)
        $(document).on("focusin", "input, button, textarea, a", function () {
            setActive($(this));
        });

        // On blur → reset default
        $(document).on("focusout", "input, button, textarea, a", function () {
            // small delay so next focused element has time to trigger
            setTimeout(function () {
                if (!$(document.activeElement).is("input, button, textarea, a")) {
                    resetDefault();
                }
            }, 50);
        });

        // On Tab navigation
        $(document).on("keydown", function (e) {
            if (e.key === "Tab" || e.keyCode === 9) {
                setTimeout(function () {
                    let el = $(document.activeElement);
                    if (el.is("input, button, textarea, a")) {
                        setActive(el);
                    } else {
                        resetDefault();
                    }
                }, 10);
            }
        });
    });


    //Custom PlaceHolder
    $('.js-select').select2({
        placeholder: function(){
            return $(this).data('placeholder');
        },
        allowClear: true
    });

    window.setEndDateFromStartDate = function (startId, endId, todayMin = '{{date("Y-m-d",strtotime(now()))}}') {
        const startInput = document.getElementById(startId);
        const endInput = document.getElementById(endId);
        if (!startInput || !endInput) return;

        startInput.addEventListener('change', function () {
            const dateVal = this.value;
            endInput.min = dateVal || todayMin;
            endInput.value = dateVal && endInput.value < dateVal ? '' : endInput.value;
        });

        startInput.form?.addEventListener('reset', () => {
            setTimeout(() => {
                endInput.min = todayMin;
                endInput.value = '';
            });
        });
    }

    $(document).ready(function () {
        //----- sticky footer
        const $footer = $('.footer-sticky, .footer--sticky');

        function toggleFooterShadow() {
            const scrollPosition = $(window).scrollTop() + $(window).height();
            const documentHeight = $(document).height();

            if (scrollPosition >= documentHeight - 100) {
                $footer.addClass('no-shadow');
            } else {
                $footer.removeClass('no-shadow');
            }
        }

        toggleFooterShadow();

        $(window).on('scroll', toggleFooterShadow);
    });


    document.querySelectorAll('.outline-wrapper').forEach(wrapper => {
        const child = wrapper.firstElementChild;
        if (!child) return;

        wrapper.style.borderRadius = getComputedStyle(child).borderRadius;
    });

})(jQuery);
