import { useState, useEffect, useRef } from 'react';
import { collection, query, orderBy, limit, onSnapshot, where, doc, updateDoc, increment } from 'firebase/firestore';

export const useAppContent = (db) => {
    // --- Banner State & Logic ---
    const [announcementSlides, setAnnouncementSlides] = useState([]);
    const [currentSlide, setCurrentSlide] = useState(0);
    const [touchStart, setTouchStart] = useState(null);
    const [touchEnd, setTouchEnd] = useState(null);
    const minSwipeDistance = 50;

    const onTouchStart = (e) => {
        setTouchEnd(null);
        setTouchStart(e.targetTouches[0].clientX);
    };

    const onTouchMove = (e) => {
        setTouchEnd(e.targetTouches[0].clientX);
    };

    const onTouchEnd = () => {
        if (!touchStart || !touchEnd) return;
        const distance = touchStart - touchEnd;
        const isLeftSwipe = distance > minSwipeDistance;
        const isRightSwipe = distance < -minSwipeDistance;

        if (isLeftSwipe) {
            setCurrentSlide((prev) => (prev + 1) % announcementSlides.length);
        } else if (isRightSwipe) {
            setCurrentSlide((prev) => (prev - 1 + announcementSlides.length) % announcementSlides.length);
        }
        setTouchStart(null);
        setTouchEnd(null);
    };

    // Auto-rotate banners
    useEffect(() => {
        if (announcementSlides.length === 0) return;
        const timer = setInterval(() => {
            setCurrentSlide((prev) => (prev + 1) % announcementSlides.length);
        }, 8000);
        return () => clearInterval(timer);
    }, [announcementSlides.length]);

    // Fetch banners from Firestore
    useEffect(() => {
        const bannersRef = collection(db, 'banners');
        const q = query(bannersRef, orderBy('order', 'asc'), orderBy('createdAt', 'desc'));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const AMIKO_LEGENDS_BANNER = {
                id: 'amiko-legends-static',
                tag: 'Amiko Legends',
                title: 'Enter the Amiko Realm',
                text: 'Venture into dangerous, ever-shifting realms where every decision matters. Collect and bond with powerful Amiko, overcome relentless enemies, and forge your path through a rogue-like adventure where only true legends endure.',
                image: 'https://app.aurory.io/images/sot-dashboard/sot-logo.png',
                video: '/amiko-vid.mp4',
                isStatic: true
            };

            if (!snapshot.empty) {
                const bannerData = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                setAnnouncementSlides([AMIKO_LEGENDS_BANNER, ...bannerData]);
            } else {
                setAnnouncementSlides([AMIKO_LEGENDS_BANNER]);
            }
        });

        return () => unsubscribe();
    }, [db]);

    // --- Rules State & Logic ---
    const [rulesCurrentSlide, setRulesCurrentSlide] = useState(0);
    const [itemsPerView, setItemsPerView] = useState(4);
    const [showRulesModal, setShowRulesModal] = useState(false);
    const [selectedTournamentForRules, setSelectedTournamentForRules] = useState(null);
    const rulesRef = useRef(null);
    const [rulesDrag, setRulesDrag] = useState({
        isDragging: false,
        startX: 0,
        currentX: 0,
        offset: 0
    });

    const rules = [
        {
            icon: "📅",
            title: "Match Scheduling",
            color: "teal",
            content: "All official match schedules will be announced in the Triad Tourney Channel. Teams are responsible for monitoring the channel and adhering to all posted schedules. Any updates, adjustments, or clarifications will be communicated by tournament organizers through the same channel."
        },
        {
            icon: "🎓",
            title: "Draft Eligibility & Authority",
            color: "purple",
            content: "Only designated and registered team coaches are authorized to make and finalize draft selections. Players who are not registered as coaches may not make or finalize draft picks during the draft phase. Non-coach players are permitted to communicate and strategize with their team captain or designated coach via the chat feature on the drafting page. All draft selections must be completed through the official draft system."
        },
        {
            icon: "🃏",
            title: "Draft Order & Selection Rules",
            color: "gold",
            content: "The first pick will be determined through a randomization process. Following the first pick, teams will select two (2) Amikos per round, adhering to the established draft order. Mirror Amikos are not allowed. Once an Amiko has been selected by a team, it may not be selected by the opposing team for that match. All selections are locked immediately upon confirmation."
        },
        {
            icon: "⏲️",
            title: "Draft Timer & Enforcement",
            color: "danger",
            content: "Each draft phase will have a strict time limit, which will be announced prior to the draft. Teams must complete their selections within the allotted time. Failure to make a selection before the timer expires will result in a random Amiko being assigned to the team. Randomly assigned selections are final and may not be appealed."
        },
        {
            icon: "✅",
            title: "Draft Stage Completion",
            color: "teal",
            content: "Teams are given a maximum of two (2) days to complete each scheduled draft stage. The draft stage is considered complete once all required Amikos have been successfully selected and locked by both teams. No changes, substitutions, or re-drafts are permitted after draft completion unless explicitly authorized by tournament organizers."
        },
        {
            icon: "⚠️",
            title: "Match Duration & Completion",
            color: "purple",
            content: "Teams are given a maximum of two (2) days to complete each scheduled match. Both teams are expected to coordinate promptly to ensure completion within the assigned timeframe. Failure to complete a match within the allotted period may result in penalties, forfeiture, or organizer intervention."
        },
        {
            icon: "📊",
            title: "Match Reporting",
            color: "gold",
            content: "Upon match completion, an official Amiko.gg tournament link will be generated. This link will be shared in the Triad Tourney Channel and will serve as the official record of the match. Only results submitted through the official tournament link will be recognized as valid."
        },
        {
            icon: "👑",
            title: "Organizer Authority",
            color: "danger",
            content: "Draft organizers reserve the right to interpret and enforce all rules outlined in this section. Any situations not explicitly covered will be resolved at the discretion of the organizers. All organizer decisions are final."
        }
    ];

    const totalRulesPages = Math.ceil(rules.length / itemsPerView);

    useEffect(() => {
        const handleResize = () => {
            if (window.innerWidth >= 1200) setItemsPerView(4);
            else if (window.innerWidth >= 768) setItemsPerView(2);
            else setItemsPerView(1);
        };

        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const nextRules = () => {
        setRulesCurrentSlide((prev) => (prev + 1) % totalRulesPages);
    };

    const prevRules = () => {
        setRulesCurrentSlide((prev) => (prev - 1 + totalRulesPages) % totalRulesPages);
    };

    const handleRulesStart = (e) => {
        const clientX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
        setRulesDrag({
            isDragging: true,
            startX: clientX,
            currentX: clientX,
            offset: -rulesCurrentSlide * 100
        });
    };

    const handleRulesMove = (e) => {
        if (!rulesDrag.isDragging) return;
        const clientX = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
        setRulesDrag(prev => ({ ...prev, currentX: clientX }));
    };

    const handleRulesEnd = () => {
        if (!rulesDrag.isDragging) return;
        const diff = rulesDrag.currentX - rulesDrag.startX;
        const threshold = 50;
        if (diff > threshold && rulesCurrentSlide > 0) {
            prevRules();
        } else if (diff < -threshold && rulesCurrentSlide < totalRulesPages - 1) {
            nextRules();
        }
        setRulesDrag({
            isDragging: false,
            startX: 0,
            currentX: 0,
            offset: 0
        });
    };

    const getRulesTransform = () => {
        if (!rulesDrag.isDragging) {
            return `translateX(-${rulesCurrentSlide * 100}%)`;
        }
        const diff = rulesDrag.currentX - rulesDrag.startX;
        const containerWidth = rulesRef.current?.offsetWidth || 1;
        const percentDiff = (diff / containerWidth) * 100;
        const newOffset = rulesDrag.offset + percentDiff;
        return `translateX(${newOffset}%)`;
    };

    // --- Ticker State & Logic ---
    const [tickerAnnouncements, setTickerAnnouncements] = useState([]);
    const [showTicker, setShowTicker] = useState(true);
    const [lastScrollY, setLastScrollY] = useState(0);
    const [recentWinners, setRecentWinners] = useState([]);
    const [showWinnerTicker, setShowWinnerTicker] = useState(false);
    const tickerTimerRef = useRef(null);
    const lastVerifiedAtRef = useRef(null);

    // Fetch Ticker Announcements
    useEffect(() => {
        const q = query(
            collection(db, 'settings'),
            where('type', '==', 'ticker_announcement'),
            orderBy('createdAt', 'desc')
        );
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setTickerAnnouncements(docs);
        });
        return () => unsubscribe();
    }, [db]);

    // Fetch Recent Winners
    useEffect(() => {
        const q = query(
            collection(db, 'drafts'),
            where('verificationStatus', '==', 'complete'),
            orderBy('verifiedAt', 'desc'),
            limit(5)
        );
        const unsubscribe = onSnapshot(q, (snapshot) => {
            if (snapshot.empty) return;
            const winnerData = snapshot.docs[0].data();
            let winnerName = 'Unknown';
            let loserName = 'Unknown';
            if (winnerData.overallWinner) {
                const teamKeyWinner = winnerData.overallWinner === 'A' ? 'teamA' : 'teamB';
                const teamKeyLoser = winnerData.overallWinner === 'A' ? 'teamB' : 'teamA';
                winnerName = winnerData.leaderNames?.[teamKeyWinner] ||
                    winnerData.leaderNames?.[winnerData.overallWinner === 'A' ? 'team1' : 'team2'] ||
                    'A Winner';
                loserName = winnerData.leaderNames?.[teamKeyLoser] ||
                    winnerData.leaderNames?.[winnerData.overallWinner === 'A' ? 'team2' : 'team1'] ||
                    'An Opponent';
            }
            const latest = {
                id: snapshot.docs[0].id,
                winnerName,
                loserName,
                title: winnerData.title || 'Untitled Draft',
                verifiedAt: winnerData.verifiedAt?.toMillis() || 0
            };
            if (latest && (!lastVerifiedAtRef.current || latest.verifiedAt > lastVerifiedAtRef.current)) {
                lastVerifiedAtRef.current = latest.verifiedAt;
                setRecentWinners([latest]);
                setShowWinnerTicker(true);
                if (tickerTimerRef.current) clearTimeout(tickerTimerRef.current);
                tickerTimerRef.current = setTimeout(() => {
                    setShowWinnerTicker(false);
                }, 10000);
            }
        });
        return () => {
            unsubscribe();
            if (tickerTimerRef.current) clearTimeout(tickerTimerRef.current);
        };
    }, [db]);

    // Handle Scroll
    useEffect(() => {
        const handleScroll = () => {
            const currentScrollY = window.scrollY;
            if (currentScrollY > lastScrollY && currentScrollY > 100) {
                setShowTicker(false);
            } else if (currentScrollY < lastScrollY) {
                setShowTicker(true);
            }
            setLastScrollY(currentScrollY);
        };
        window.addEventListener('scroll', handleScroll, { passive: true });
        return () => window.removeEventListener('scroll', handleScroll);
    }, [lastScrollY]);

    // --- News State & Logic ---
    const [news, setNews] = useState([]);
    const [newsLoading, setNewsLoading] = useState(true);
    const [selectedNews, setSelectedNews] = useState(null);
    const [showNewsModal, setShowNewsModal] = useState(false);
    const [hasNewNews, setHasNewNews] = useState(false);

    useEffect(() => {
        const newsRef = collection(db, 'news');
        const q = query(newsRef, orderBy('createdAt', 'desc'), limit(3));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const newsData = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setNews(newsData);
            setNewsLoading(false);
            if (newsData.length > 0) {
                const lastSeenId = localStorage.getItem('lastSeenNewsId');
                if (lastSeenId !== newsData[0].id) {
                    setHasNewNews(true);
                }
            }
        });
        return () => unsubscribe();
    }, [db]);

    const handleNewsClick = (item) => {
        setSelectedNews(item);
        setShowNewsModal(true);
        try {
            updateDoc(doc(db, 'news', item.id), {
                viewCount: increment(1)
            });
        } catch (error) {
            console.error('Error incrementing news view count:', error);
        }
        if (news.length > 0) {
            localStorage.setItem('lastSeenNewsId', news[0].id);
            setHasNewNews(false);
        }
    };

    return {
        // Banners
        announcementSlides, setAnnouncementSlides,
        currentSlide, setCurrentSlide,
        onTouchStart, onTouchMove, onTouchEnd,
        // Rules
        rules, rulesCurrentSlide, setRulesCurrentSlide, itemsPerView, totalRulesPages,
        nextRules, prevRules, handleRulesStart, handleRulesMove, handleRulesEnd,
        getRulesTransform, rulesRef, showRulesModal, setShowRulesModal,
        rulesDrag,
        selectedTournamentForRules, setSelectedTournamentForRules,
        // Tickers
        tickerAnnouncements, showTicker, recentWinners, showWinnerTicker,
        // News
        news, newsLoading, selectedNews, setSelectedNews,
        showNewsModal, setShowNewsModal, hasNewNews, handleNewsClick
    };
};
