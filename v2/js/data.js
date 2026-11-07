/* ============================================================
   Wetalk — data: languages, difficulties, categories,
   interview questions, TOEFL prompts, scoring criteria.
   ============================================================ */
(function (global) {
  "use strict";

  var LANGUAGES = [
    { code: "en", flag: "🇺🇸", name: "English",     speech: "en-US" },
    { code: "es", flag: "🇪🇸", name: "Spanish",    speech: "es-ES" },
    { code: "fr", flag: "🇫🇷", name: "French",     speech: "fr-FR" },
    { code: "de", flag: "🇩🇪", name: "German",     speech: "de-DE" },
    { code: "zh", flag: "🇨🇳", name: "Chinese",    speech: "zh-CN" },
    { code: "it", flag: "🇮🇹", name: "Italian",    speech: "it-IT" },
    { code: "ar", flag: "🇸🇦", name: "Arabic",     speech: "ar-SA" },
    { code: "pt", flag: "🇧🇷", name: "Portuguese", speech: "pt-BR" },
    { code: "ko", flag: "🇰🇷", name: "Korean",     speech: "ko-KR" },
    { code: "ja", flag: "🇯🇵", name: "Japanese",   speech: "ja-JP" },
    { code: "th", flag: "🇹🇭", name: "Thai",       speech: "th-TH" },
    { code: "ur", flag: "🇵🇰", name: "Urdu",       speech: "ur-PK" }
  ];

  var DIFFICULTIES = [
    { code: "random", icon: "🎲", name: "Random" },
    { code: "easy",   icon: "🟢", name: "Easy" },
    { code: "medium", icon: "🟡", name: "Medium" },
    { code: "hard",   icon: "🔴", name: "Hard" }
  ];

  // NSDA Impromptu Speaking official topic types.
  var CATEGORIES = [
    { code: "random",        icon: "🎯", name: "Random" },
    { code: "quotation",     icon: "📜", name: "Quotation" },
    { code: "proverb",       icon: "🧠", name: "Proverb" },
    { code: "abstract_word", icon: "🔤", name: "Abstract Word" },
    { code: "object",        icon: "🧭", name: "Object" },
    { code: "event",         icon: "🏛️", name: "Event" },
    { code: "famous_person", icon: "⭐", name: "Famous Person" },
    { code: "phrase",        icon: "💭", name: "Phrase" },
    { code: "current_event", icon: "📰", name: "Current Event" }
  ];

  // Vericant K-12 admissions interview — the five sections, their question banks,
  // per-section timing, follow-up prompts, and the official SEE scoring dimensions.
  var VERICANT = {
    sections: [
      { code: "intro",      name: "Introduction", icon: "👋",  hasFollowup: true  },
      { code: "picture",    name: "Picture",      icon: "🖼️", hasFollowup: true  },
      { code: "indepth",    name: "In-depth",     icon: "🧭", hasFollowup: true  },
      { code: "reflective", name: "Reflective",   icon: "🪞", hasFollowup: false },
      { code: "freespeech", name: "Free Speech",  icon: "🎙️", hasFollowup: false }
    ],
    timing: {
      intro:      { prep: 15, speak: 60 },
      picture:    { prep: 30, speak: 60 },
      indepth:    { prep: 30, speak: 90 },
      reflective: { prep: 15, speak: 60 },
      freespeech: { prep: 30, speak: 120 },
      followup:   { prep: 10, speak: 45 }
    },
    questions: {
      intro: [
        "Tell me a little about yourself.",
        "How do you relax after a long day?",
        "What is the first thing you do when you wake up?",
        "What impact has technology had on you?",
        "Who is your favorite author and why?",
        "What is your favorite animal and why?",
        "Do you prefer the city or the countryside, and why?",
        "If you could invite anyone to dinner, who would it be?",
        "What type of books do you most enjoy reading?",
        "What is your favorite outdoor activity?",
        "Describe a classmate or friend who is different from you.",
        "What do you like to do on weekends?"
      ],
      indepth: [
        "Share an experience of overcoming a difficulty.",
        "Describe a time you disagreed with a friend and what you did.",
        "Tell me about a time you made a mistake and what you learned.",
        "What was the best and worst part of your most recent vacation?",
        "Describe a travel experience — who did you see, and what surprised you?",
        "Tell me about a time you helped someone and what happened.",
        "What has been your happiest moment in the past few years?",
        "Describe a time you tried something new and how it turned out.",
        "Tell me about a challenge you faced at school and how you handled it.",
        "Who has helped you the most? Give an example.",
        "Describe a moment when you had to be brave.",
        "Tell me about a goal you set and how you worked toward it."
      ],
      reflective: [
        "What is most important to you and why?",
        "What does friendship mean to you?",
        "What do you think makes a good leader?",
        "What are you most proud of?",
        "What would you like to change about the world?",
        "If you could change one law, what would you change and why?",
        "What is something you believe strongly in?",
        "What does success mean to you?",
        "What have you learned about yourself recently?",
        "What does home mean to you?"
      ],
      freespeech: [
        "Introduce yourself to the school.",
        "Talk about a passion or hobby that defines you.",
        "Tell the school why you want to study abroad.",
        "Describe how you would contribute to the school community.",
        "Talk about a person who inspires you and why.",
        "Explain what you are most looking forward to about boarding school.",
        "Share something about yourself that makes you different from other applicants.",
        "Talk about a challenge you faced and the lesson you learned from it."
      ]
    },
    followups: {
      intro: [
        "Can you tell me more about that?",
        "Why is that important to you?",
        "How did you get interested in that?",
        "What do you enjoy most about it?",
        "Can you give me a specific example?",
        "What would your friends say about that?"
      ],
      picture: [
        "Which of the two pictures do you prefer, and why?",
        "What do you think is happening in this picture?",
        "What does this picture remind you of?",
        "If you were in this picture, what would you be doing?",
        "How does this picture make you feel?",
        "What story do you imagine is behind this picture?"
      ],
      indepth: [
        "How did that experience change you?",
        "What would you do differently now?",
        "What did you learn from that moment?",
        "Why do you think that happened?",
        "How did the people around you react?",
        "Would you do it again? Why or why not?"
      ]
    },
    pictures: [
      "images/p1.svg", "images/p2.svg", "images/p3.svg", "images/p4.svg", "images/p5.svg",
      "images/p6.svg", "images/p7.svg", "images/p8.svg", "images/p9.svg", "images/p10.svg"
    ],
    see: [
      { key: "range",       name: "Linguistic Range",        desc: "variety of words and expressions at your disposal" },
      { key: "accuracy",    name: "Grammatical Accuracy",    desc: "control of grammar" },
      { key: "fluency",     name: "Fluency",                 desc: "pace, clarity, and speech production" },
      { key: "interaction", name: "Conversational Interaction", desc: "engagement and participation" },
      { key: "coherence",   name: "Coherence",               desc: "well-structured speech that leaves no loose ends" }
    ]
  };

var TOEFL = {
    // Official TOEFL Speaking interview question sets (4 questions per set).
    sets: [
    {
        "topic": "Physical Health",
        "img": "images/p12.svg",
        "questions": [
            "How do you usually maintain your physical health in your daily life?",
            "What kind of nutritional habits do you think are important for staying healthy?",
            "Is there any change you would like to make to your own dietary habits in the future? Why?",
            "Some people believe that mental health is just as important as physical health. Do you agree or disagree and why?"
        ]
    },
    {
        "topic": "Exercise",
        "img": "images/p11.svg",
        "questions": [
            "Do you think exercising every day is important? Why or why not?",
            "How often do you exercise in a typical week?",
            "What type of exercise would you recommend to your family members?",
            "Some people say that exercise does not need to be intense to be beneficial. Do you agree or disagree?"
        ]
    },
    {
        "topic": "Music",
        "img": "images/p10.svg",
        "questions": [
            "How often do you listen to music in your daily life?",
            "What genres or styles of music do you usually enjoy?",
            "Do you think that music has the power to influence people's emotions?",
            "If you could attend any artist's concert, whose would it be and why?"
        ]
    },
    {
        "topic": "Music & Instruments",
        "img": "images/p10.svg",
        "questions": [
            "Describe a musical instrument or a skill you can play or do.",
            "Describe a personal experience related to music.",
            "Do you prefer listening to music alone or enjoying it with others?",
            "Should schools require students to take music classes?"
        ]
    },
    {
        "topic": "Movie",
        "img": "images/p10.svg",
        "questions": [
            "What kind of movies do your family or friends generally like to watch? For example, do they prefer action movies, comedies, dramas, or other types?",
            "When you watch a movie, do you prefer to watch after work or school on weekdays, or do you like to watch during the weekends? Why?",
            "In the past, people mostly watched movies in theaters. Today, many people watch movies at home. Do you think that movie theaters will continue to exist in the future? Why or why not?",
            "Some people believe that movies can be a powerful tool for educating people and raising awareness about important issues. Do you agree with this idea, or do you think there are other, more effective ways to educate people?"
        ]
    },
    {
        "topic": "Movies & Personal Taste",
        "img": "images/p10.svg",
        "questions": [
            "How often do you watch movies in your daily life?",
            "What type of movies do you prefer? For example, action movies, comedies, or dramas.",
            "Share a movie you have watched and talk about your feelings after seeing it.",
            "Do you think watching movies at home offers a better experience than going to the cinema?"
        ]
    },
    {
        "topic": "Hobbies",
        "img": "images/p6.svg",
        "questions": [
            "What is your recent hobby?",
            "What kind of new hobby do you want to develop?",
            "What prevents you from developing that hobby?",
            "Some people think that a single hobby is better. Others prefer multiple hobbies. Which one do you prefer?"
        ]
    },
    {
        "topic": "Culture & Festivals",
        "img": "images/p9.svg",
        "questions": [
            "Do you celebrate holidays with your family, or your friends?",
            "How often do you celebrate holidays?",
            "Describe one unforgettable holiday celebration.",
            "Do you believe traditions such as holidays are still important today?"
        ]
    },
    {
        "topic": "Goals",
        "img": "images/p5.svg",
        "questions": [
            "Have you made any clear goals?",
            "What do you do when you encounter difficulties?",
            "Is it important to set goals for yourself?",
            "Is setting a goal important for young kids?"
        ]
    },
    {
        "topic": "Goals & Personal Growth",
        "img": "images/p5.svg",
        "questions": [
            "Describe an important personal goal you have and the steps you are currently taking to achieve it.",
            "What challenges might you face along the way?",
            "Why is this goal important for your personal growth?",
            "How will working toward this goal help you develop as a person?"
        ]
    },
    {
        "topic": "Clothes & Fashion",
        "img": "images/p1.svg",
        "questions": [
            "Do you buy clothes frequently?",
            "What kind of clothes do you prefer to wear?",
            "Do you prepare your outfit in the morning or the night before?",
            "The trend of fashion changes fast. Do you think that keeping pace with fashion is a waste of money? Why?"
        ]
    },
    {
        "topic": "Vacation",
        "img": "images/p2.svg",
        "questions": [
            "Where have you been to for vacation?",
            "Do you prefer winter vacation or summer vacation?",
            "Do you prefer one long vacation or many short vacations?",
            "Do you prefer to make plans for travel with your friends or joining an agency?"
        ]
    },
    {
        "topic": "Vacations & Well-being",
        "img": "images/p2.svg",
        "questions": [
            "Do you enjoy vacations?",
            "What do you usually do during vacations?",
            "Do you prefer staying at home or going traveling during vacations?",
            "Do you think that vacations are important to people's mental health? Why?"
        ]
    },
    {
        "topic": "Commuting",
        "img": "images/p1.svg",
        "questions": [
            "Where do you normally go during the weekdays? How do you usually go there?",
            "How do your family members go to work?",
            "Some people prefer to live close to school or the workplace, while others think it is okay to live far. What do you think?",
            "Should employers pay for the travel expenses of workers?"
        ]
    },
    {
        "topic": "Technology",
        "img": "images/p14.svg",
        "questions": [
            "Is technology important in your life?",
            "Have you ever felt overwhelmed by technology when using technological products?",
            "Is technology going to replace some jobs in the future?",
            "Is technology going to limit our imagination or creativity?"
        ]
    },
    {
        "topic": "Electronic Devices",
        "img": "images/p14.svg",
        "questions": [
            "How often do you use electronic devices?",
            "Do you take breaks when using technology?",
            "What do you use your cellphone for?",
            "Do you agree that electronic devices have a negative impact on our lives?"
        ]
    },
    {
        "topic": "Digital Devices",
        "img": "images/p14.svg",
        "questions": [
            "How many hours a day do you typically spend using electronics like smartphones, tablets, or computers?",
            "What types of activities do you usually do on your digital devices? For example, do you use them for work, entertainment, or socializing?",
            "Can you tell me about a time when you needed to take a break from using digital tools? How did it affect you?",
            "Some people believe that spending too much time on personal technology can negatively impact face-to-face social interactions. Do you agree or disagree with this viewpoint? Why?"
        ]
    },
    {
        "topic": "Reading Habits",
        "img": "images/p5.svg",
        "questions": [
            "Are you reading more or fewer books now than before?",
            "Do you think reading can help people relieve stress?",
            "Do you think reading different kinds of books can help people make friends more easily?",
            "Do you think the next generation will read less than the current generation?"
        ]
    },
    {
        "topic": "Work-Life Balance",
        "img": "images/p6.svg",
        "questions": [
            "Can you share one or two strategies that you use that you think are effective in managing your work-life balance?",
            "Many companies are now developing programs to help employees manage work-life balance. Would programs like this affect your interest in working for a particular company? Why or why not?",
            "Do you think it is more important to maintain a good work-life balance now than in the past?",
            "Looking to the future, do you think people's attitudes towards work-life balance will change? For example, do you think people will prioritize personal life over work, or work over personal life? Explain your thoughts."
        ]
    },
    {
        "topic": "Social Gatherings",
        "img": "images/p9.svg",
        "questions": [
            "Do you enjoy social gatherings with friends or family? Why or why not?",
            "In your culture, what activities do people usually do during social gatherings?",
            "How can social gatherings help people build or maintain friendships?",
            "Some people prefer spending time with a few close friends, while others prefer large social events where they can meet many new people. Which do you prefer?"
        ]
    },
    {
        "topic": "Environment Protection",
        "img": "images/p3.svg",
        "questions": [
            "Have you taken any actions to reduce your impact on the environment?",
            "Can you describe some environmental protection measures in your community or neighborhood?",
            "If you had the opportunity to participate in nature or environmental activities, what would you do?",
            "Some people believe individual actions are not enough to solve environmental problems and that major changes must come from government policies. Do you agree or disagree?"
        ]
    },
    {
        "topic": "Dining Out",
        "img": "images/p8.svg",
        "questions": [
            "How often do you usually go out for dinner?",
            "What kind of food do you like to eat? Why?",
            "Do you think that the service of a restaurant is equally important to the quality of its dishes?",
            "Some people prefer to eat at home. Others prefer to go out for dinner. Which one do you prefer? Why?"
        ]
    },
    {
        "topic": "Grocery Shopping",
        "img": "images/p8.svg",
        "questions": [
            "How often do you go grocery shopping?",
            "What do you usually buy at grocery stores?",
            "Do you tend to make impulse purchases when shopping? Why or why not?",
            "Some people prefer shopping at local grocery stores, while others prefer large supermarkets. Which do you prefer? Why?"
        ]
    },
    {
        "topic": "Shopping: Online vs Offline",
        "img": "images/p1.svg",
        "questions": [
            "Do you prefer shopping online or offline?",
            "What factors do you prioritize when shopping? For example, price, brand, or quality.",
            "Share your most satisfying recent shopping experience — and why it impressed you so much.",
            "Do you think physical stores will disappear as online shopping continues to grow?"
        ]
    },
    {
        "topic": "Online Shopping",
        "img": "images/p14.svg",
        "questions": [
            "How often do you shop online — weekly, monthly, or less frequently?",
            "If you shop online, what types of products are you likely to buy? For example, clothes, electronics, or groceries?",
            "Some people believe shopping in physical stores is more convenient, while others think online shopping is a worse experience because it lacks the human interaction of in-person shopping. What is your opinion, and why?",
            "Some people believe physical stores might one day disappear because of online shopping. What is your opinion and why?"
        ]
    },
    {
        "topic": "Social Media",
        "img": "images/p14.svg",
        "questions": [
            "Which social media platforms do you usually use and how often do you use them?",
            "Describe a positive or negative experience you have had while using social media.",
            "What kinds of content do you think are appropriate to share on social media? Why?",
            "Do you think social media has a positive or negative impact on human connection and relationships? Why?"
        ]
    },
    {
        "topic": "Social Media & Generations",
        "img": "images/p14.svg",
        "questions": [
            "If you were to choose a social media platform to use most regularly, which one would you choose, and why?",
            "Do you think social media is more beneficial for younger people or older people? Why?",
            "Some people believe that social media can help people stay connected, while others think it can lead to feelings of isolation. What are your thoughts on this? Do you agree or disagree? Why?",
            "Do you think social media use will continue to grow in the future, or will people start to limit their usage? What factors do you think will most affect future usage of social media? Explain your thoughts."
        ]
    },
    {
        "topic": "Education",
        "img": "images/p4.svg",
        "questions": [
            "Which do you think is more important for a college: offering a wide variety of courses or having small class sizes?",
            "Imagine that you are preparing for a test. Would you prefer to study by yourself or with a group? Why?",
            "Some people believe that online courses offer more flexibility and accessibility than traditional classroom settings and are therefore superior. Do you agree or disagree? Why?",
            "Do you think online learning will someday completely replace in-person learning? Explain your thoughts."
        ]
    },
    {
        "topic": "Remote Work",
        "img": "images/p14.svg",
        "questions": [
            "Do you prefer to work remotely? How often would you prefer to work remotely?",
            "What challenges or difficulties do you think remote work may involve?",
            "Do you think companies should ensure fairness when giving employees remote-work opportunities? Why or why not?",
            "Do you think remote work will become a mainstream trend in the future? Why or why not?"
        ]
    },
    {
        "topic": "Time Management",
        "img": "images/p5.svg",
        "questions": [
            "What tools or methods do you usually use to manage your time effectively?",
            "How do you normally organize your daily tasks or plan your time?",
            "Describe a time when you had to handle several tasks or responsibilities at the same time.",
            "How do you balance improving efficiency with reducing stress?"
        ]
    },
    {
        "topic": "Sports",
        "img": "images/p7.svg",
        "questions": [
            "Do you currently play any sports or engage regularly in any physical activities?",
            "If you were able to, what sport that you do not currently play would you like to be really good at? Why that particular sport?",
            "Tell me about an experience you had while playing a sport or engaging in a physical activity that you remember well. What made it memorable?",
            "Some people believe that children should not participate in contact sports like rugby or hockey because they could get hurt, while others believe that these sports teach awareness and teamwork. What do you think and why?"
        ]
    },
    {
        "topic": "Food & Diet Routine",
        "img": "images/p8.svg",
        "questions": [
            "When you have a meal at school or work, do you prefer to eat alone or with friends or co-workers? Why?",
            "What kind of meals do your family or friends generally like to eat? For example, do they prefer traditional home-cooked dishes, fast food, or other types?",
            "In recent years, many people have argued that plant-based diets are better for individual health and for the planet. Do you think that in the future more people will adopt plant-based diets? Why or why not?",
            "Some people believe that having regular meal times contributes to better health and financial well-being. Do you agree or disagree with this idea? Explain your answer."
        ]
    },
    {
        "topic": "Job Satisfaction",
        "img": "images/p1.svg",
        "questions": [
            "What do you think are the most important things to consider when looking for a job?",
            "Can you describe a job that either you or one of your friends has had? What kind of work was involved?",
            "What kinds of things do you think can lead people to feel unhappy in their work? Can you tell me about one or two of them?",
            "Some people believe that working for a large company offers more advantages than working for a small company, while others prefer the opposite. What do you think and why?"
        ]
    },
    {
        "topic": "Art",
        "img": "images/p10.svg",
        "questions": [
            "Which form of art do you prefer in your daily life? For example, painting, music, or other art forms?",
            "Do you tend to create your own artworks or appreciate artworks created by others?",
            "If you could create works of art, would you choose to share them with others or keep them just for your own enjoyment?",
            "Do you think music and art are more powerful in expression than language? Why or why not?"
        ]
    },
    {
        "topic": "Weather",
        "img": "images/p3.svg",
        "questions": [
            "What is the climate like in the city where you live?",
            "How would you prepare if the weather forecast said it was going to rain?",
            "Would you prefer to live in a city with a mild and balanced climate or in a city with four distinct seasons? Why?",
            "What should the government do to reduce the impact of extreme weather?"
        ]
    },
    {
        "topic": "Sleep Habits",
        "img": "images/p1.svg",
        "questions": [
            "Do you usually go to bed early or late?",
            "What is your typical routine before bedtime?",
            "Some people have trouble sleeping when they stay overnight at a hotel or at a friend's house. Are you able to sleep well in unfamiliar places?",
            "Should schools start classes later to allow students more sleep?"
        ]
    },
    {
        "topic": "Friendship",
        "img": "images/p9.svg",
        "questions": [
            "Do you have a large group of friends, or do you prefer to have a smaller group of friends?",
            "Describe a time when a friendship taught you something valuable or helped you see something from a new perspective.",
            "In your opinion, what makes a friendship last a long time?",
            "Some people believe that maintaining friendships is essential for emotional well-being and life satisfaction. Do you agree or disagree with this viewpoint? Why or why not?"
        ]
    },
    {
        "topic": "Friends & Socializing",
        "img": "images/p9.svg",
        "questions": [
            "Do you prefer spending time with friends or being alone? Why?",
            "What do you usually do when you spend time with your friends?",
            "Do you prefer having a few close friends or many friends? Why?",
            "How does friendship help people build or maintain relationships?"
        ]
    },
    {
        "topic": "Personal Organization",
        "img": "images/p5.svg",
        "questions": [
            "Do you consider yourself to be an organized person? Why or why not?",
            "Would you say that your organization habits have changed or stayed the same over time? Why do you think that is?",
            "Do you think organizational skills should be taught in schools? Why or why not?",
            "Some people believe that being organized can significantly reduce stress. Do you agree or disagree with this viewpoint? Why?"
        ]
    },
    {
        "topic": "Gardening",
        "img": "images/p6.svg",
        "questions": [
            "Do you have a garden or any plants that you take care of? If so, how often do you spend time gardening? If not, why?",
            "What kinds of plants or gardens have you seen or heard about that you found interesting or appealing? Describe them and talk about why you found them interesting.",
            "What challenges do you think people face when trying to grow plants or maintain a garden?",
            "Some people believe that gardening can have positive effects on personal mental health and well-being. Do you agree or disagree with this viewpoint? Why?"
        ]
    },
    {
        "topic": "Leisure Activities",
        "img": "images/p6.svg",
        "questions": [
            "Do you usually spend your leisure or free time indoors or outdoors?",
            "Can you describe one of your favorite leisure activities and explain why you enjoy it?",
            "Do you prefer to engage in the same leisure activities over and over, or do you regularly seek out new activities?",
            "Some people believe that regularly engaging in leisure activities is important for mental health. What are your thoughts on this?"
        ]
    },
    {
        "topic": "Daily Routine",
        "img": "images/p1.svg",
        "questions": [
            "Do you have a regular or fixed daily routine?",
            "What is a typical day like for you?",
            "How do you manage unexpected changes to your routine?",
            "Some people say that a clear routine helps them to be more productive, while others claim that the ability to stay flexible helps with productivity. Which point of view do you agree with?"
        ]
    },
    {
        "topic": "Childhood Education",
        "img": "images/p4.svg",
        "questions": [
            "Did you enjoy your childhood education?",
            "Describe one activity or program you took part in. What was so special about it?",
            "Describe one skill you learned as a kid at school. Does this skill prepare you for life outside of school?",
            "Some people say that schools nowadays should focus more on important skills like teamwork, rather than focusing on teaching facts. Do you agree?"
        ]
    },
    {
        "topic": "Renewable Energy",
        "img": "images/p13.svg",
        "questions": [
            "How important is the issue of renewable energy, such as wind and solar power, to you personally? Why would you say you feel that way?",
            "Describe a time when you or someone you know tried to reduce energy use. What actions were taken? What made it easy or difficult?",
            "In your daily life, have you noticed any renewable energy initiatives in your community? If yes, what have you seen? How do they impact your area?",
            "Many believe that transitioning to renewable energy is crucial for environmental sustainability, while others worry about the costs involved. Do you think the benefits of renewable energy outweigh the drawbacks? Why or why not?"
        ]
    },
    {
        "topic": "History Education",
        "img": "images/p4.svg",
        "questions": [
            "What is one aspect of history that you find particularly interesting?",
            "Describe a history-related activity or project you enjoyed, and what made it engaging?",
            "If you were to visit a historical site you have never visited before, which one would you choose and why?",
            "Do you think the study of history remains important in today's educational system? Why or why not?"
        ]
    },
    {
        "topic": "History",
        "img": "images/p5.svg",
        "questions": [
            "Where did you get your history knowledge — from your classes or outside the classroom?",
            "When you learn history, which aspect of history were you interested in the most?",
            "Have you been to historic sites or museums? Were they helpful?",
            "Can we avoid mistakes in the future by learning from history?"
        ]
    },
    {
        "topic": "Gifts",
        "img": "images/p9.svg",
        "questions": [
            "Do you enjoy giving and receiving gifts?",
            "What kind of gifts are popular in your country?",
            "Describe a memorable gift you received.",
            "Some people say that gifts are essential in maintaining relationships. Do you agree or disagree?"
        ]
    },
    {
        "topic": "Parks & Recreation",
        "img": "images/p6.svg",
        "questions": [
            "Can you tell me about a memorable trip that you or one of your friends took to a park or recreational area? What made it special?",
            "Do you think parks and recreational spaces are more important for adults or for children? Why?",
            "Some people believe that parks play a crucial role in promoting community health and well-being, so local governments should spend more money on them. Do you agree or disagree, and why?",
            "In many large cities, there is a tension between building more parks and using that space to build more housing. Do you think the need for more housing is more important or less important than the need for parks and recreational spaces? Why?"
        ]
    },
    {
        "topic": "Nature & Outdoors",
        "img": "images/p3.svg",
        "questions": [
            "If you had the chance to spend more time outdoors, what would you want to do?",
            "How do you usually feel while you are outdoors compared to when you are indoors?",
            "Do you think avoiding spending time outdoors in nature makes a difference in people's health and well-being? Why or why not?",
            "Do you think outdoor spaces should be free for everyone to use, or is it acceptable to charge fees? Why?"
        ]
    },
    {
        "topic": "Finance Habits",
        "img": "images/p1.svg",
        "questions": [
            "How often do you review your money management, such as tracking your spending?",
            "Can you describe one or two methods you or someone you know uses to manage money?",
            "Tell me about a financial goal you have achieved. What motivated you to achieve this goal?",
            "Some people believe that financial responsibility education should be mandatory in schools to help students manage money effectively as adults. What do you think about it?"
        ]
    },
    {
        "topic": "Self-Improvement",
        "img": "images/p5.svg",
        "questions": [
            "In which areas of skill do you hope to develop in the future?",
            "What drives you to take action when pursuing self-improvement? Could you share some of your past experiences or books you have read?",
            "Do you believe self-development requires independent learning, or should it be guided by others?",
            "Compared to the past, do you think it is easier today to engage in self-learning and personal growth?"
        ]
    },
    {
        "topic": "Public Transportation",
        "img": "images/p1.svg",
        "questions": [
            "Do you take public transport? How often?",
            "What are some advantages or disadvantages of taking public transport?",
            "Would you consider access to public transport when choosing a place to live or moving? Or would you choose to move just for better access to public transport?",
            "Some say that there should be more investment in public transport. Do you agree?"
        ]
    },
    {
        "topic": "Cultural Festivals",
        "img": "images/p9.svg",
        "questions": [
            "Have you been to cultural festivals? If not, do you want to go to one?",
            "If you go to a cultural festival, what do you want to experience or see?",
            "After you go to a local cultural festival, what do you want to share with people?",
            "Are cultural festivals just for fun, or do they have real meaning?"
        ]
    },
    {
        "topic": "Health & Wellness",
        "img": "images/p12.svg",
        "questions": [
            "Do you have any specific routines or practices you use to maintain your physical well-being? If so, what are they?",
            "Can you describe any dietary choices or habits that you follow to stay healthy? Give details to explain your answer.",
            "If you could make one significant change to your diet or exercise routine to stay healthy, what would it be? Why would you make that particular choice?",
            "Some people believe that mental health is just as important as physical health and should be given equal attention. Do you agree or disagree with this viewpoint? Why?"
        ]
    }
]
  };

  var CRITERIA = [
    { key: "organization", name: "Organization" },
    { key: "analysis",     name: "Analysis" },
    { key: "delivery",     name: "Delivery" },
    { key: "creativity",   name: "Creativity" }
  ];

  var TOEFL_CRITERIA = [
    { key: "delivery", name: "Delivery",          desc: "clear, fluid, well-paced speech" },
    { key: "language", name: "Language Use",      desc: "grammar accuracy & vocabulary range" },
    { key: "topic",    name: "Topic Development", desc: "complete, coherent answer with reasons & examples" }
  ];

  global.WETALK_LANGUAGES = LANGUAGES;
  global.WETALK_DIFFICULTIES = DIFFICULTIES;
  global.WETALK_CATEGORIES = CATEGORIES;
  global.WETALK_VERICANT = VERICANT;
  global.WETALK_SEE_CRITERIA = VERICANT.see;
  global.WETALK_TOEFL = TOEFL;
  global.WETALK_CRITERIA = CRITERIA;
  global.WETALK_TOEFL_CRITERIA = TOEFL_CRITERIA;
})(window);
