export interface RoadmapItem {
  id: string;
  title: string;
  description: string;
  requiredSkills: string[];
  keyTopics: string[];
  recommendedProject: string;
  estimatedWeeks: string;
}

export interface RoadmapPhase {
  phaseTitle: string;
  items: RoadmapItem[];
}

export interface RoadmapData {
  roleId: string;
  roleTitle: string;
  overview: string;
  targetTimeline: string;
  phases: RoadmapPhase[];
}

export const PRESET_ROADMAPS: Record<string, RoadmapData> = {
  "frontend": {
    roleId: "frontend",
    roleTitle: "Frontend Developer",
    overview: "Master modern web development from semantic HTML/CSS to advanced React ecosystems, state management, and performance tuning.",
    targetTimeline: "6 Months",
    phases: [
      {
        phaseTitle: "Phase 1: Web Foundations & Modern JavaScript",
        items: [
          {
            id: "fe-1",
            title: "HTML5, Semantic Markup & SEO",
            description: "Build accessible, responsive page skeletons using HTML5 tags, accessibility standards (ARIA), and SEO best practices.",
            requiredSkills: ["HTML5", "ARIA", "Semantic Markup"],
            keyTopics: ["Document Structure", "Meta tags & OpenGraph", "Forms & Client Validation", "Screen Readers"],
            recommendedProject: "Build an Accessible Developer Portfolio page with 100/100 Lighthouse score.",
            estimatedWeeks: "2 Weeks"
          },
          {
            id: "fe-2",
            title: "Modern CSS, Flexbox, Grid & Tailwind",
            description: "Master modern CSS styling without relying on legacy hacks, including CSS Grid, Flexbox, responsive design, and Tailwind CSS.",
            requiredSkills: ["CSS3", "Flexbox", "CSS Grid", "Tailwind CSS"],
            keyTopics: ["Box Model", "Grid Template Areas", "Media Queries & Mobile-first", "Tailwind utility patterns"],
            recommendedProject: "Build a responsive E-commerce Product Page with interactive galleries and cart layouts.",
            estimatedWeeks: "3 Weeks"
          },
          {
            id: "fe-3",
            title: "Deep JavaScript (ES6+) & DOM Manipulation",
            description: "Understand scopes, closures, async/await, event loops, promises, and dynamic DOM manipulation.",
            requiredSkills: ["JavaScript", "ES6+", "Async/Await", "DOM API"],
            keyTopics: ["Closures & Prototypes", "Event Bubbling & Delegation", "Fetch API & Promises", "Event Loop microtasks"],
            recommendedProject: "Build an interactive Kanban Task Board with drag-and-drop and LocalStorage persistence.",
            estimatedWeeks: "4 Weeks"
          }
        ]
      },
      {
        phaseTitle: "Phase 2: Modern Frontend Frameworks & Ecosystem",
        items: [
          {
            id: "fe-4",
            title: "React.js Core & Hooks Mastery",
            description: "Component lifecycle, JSX, hooks (useState, useEffect, useMemo, useCallback, useRef), and unidirectional data flow.",
            requiredSkills: ["React", "React Hooks", "Component Design"],
            keyTopics: ["Virtual DOM diffing", "Custom Hooks", "Context API", "Component Re-render optimization"],
            recommendedProject: "Build a Real-time Weather & Air Quality Dashboard with API polling and interactive charts.",
            estimatedWeeks: "4 Weeks"
          },
          {
            id: "fe-5",
            title: "TypeScript for Frontend",
            description: "Add static typing to React applications to prevent bugs and improve developer experience.",
            requiredSkills: ["TypeScript", "Type Inference", "Generics"],
            keyTopics: ["Interfaces vs Types", "Typing React Props & Events", "Generics", "Utility Types (Pick, Omit, Partial)"],
            recommendedProject: "Refactor your React project to TypeScript with strict mode enabled and zero `any` types.",
            estimatedWeeks: "3 Weeks"
          },
          {
            id: "fe-6",
            title: "Next.js & Server-Side Rendering (SSR/SSG)",
            description: "Modern fullstack frontend with Next.js App Router, Server Components (RSC), SEO optimization, and API routing.",
            requiredSkills: ["Next.js", "Server Components", "SSR/SSG"],
            keyTopics: ["App Router & Layouts", "Client vs Server Components", "Static Site Generation", "Dynamic Route Handlers"],
            recommendedProject: "Build a full-fledged Developer Blog with MDX, dynamic tagging, and dynamic OG images.",
            estimatedWeeks: "4 Weeks"
          }
        ]
      },
      {
        phaseTitle: "Phase 3: State Management, Testing & Production Readiness",
        items: [
          {
            id: "fe-7",
            title: "Global State Management & Server State",
            description: "Master client cache and global state with tools like Zustand, Redux Toolkit, or TanStack React Query.",
            requiredSkills: ["Zustand", "TanStack Query", "State Management"],
            keyTopics: ["Client State vs Server Cache", "Optimistic Updates", "Infinite Query & Pagination", "Cache Invalidation"],
            recommendedProject: "Build a Real-time Social Feed with infinite scroll, like counters, and instant cache updates.",
            estimatedWeeks: "3 Weeks"
          },
          {
            id: "fe-8",
            title: "Frontend Testing, CI/CD & Performance Audit",
            description: "Write unit and component tests with Vitest / React Testing Library, and optimize Core Web Vitals.",
            requiredSkills: ["Testing", "Vitest", "Lighthouse", "Core Web Vitals"],
            keyTopics: ["Unit testing components", "Mocking API calls", "LCP / FID / CLS optimization", "Vercel / GitHub Actions CI"],
            recommendedProject: "Configure GitHub Actions CI pipeline to run lints, typechecks, and tests before automated deployment.",
            estimatedWeeks: "2 Weeks"
          }
        ]
      }
    ]
  },
  "backend": {
    roleId: "backend",
    roleTitle: "Backend Developer",
    overview: "Master backend architectures, REST & GraphQL APIs, database design (SQL & NoSQL), authentication, caching, and scalable microservices.",
    targetTimeline: "6 Months",
    phases: [
      {
        phaseTitle: "Phase 1: Languages, Runtime & API Fundamentals",
        items: [
          {
            id: "be-1",
            title: "Node.js / Express or Python / FastAPI",
            description: "Understand server runtime, event-driven I/O, middleware architecture, and designing clean RESTful endpoints.",
            requiredSkills: ["Node.js", "Express", "REST APIs", "Async Programming"],
            keyTopics: ["Event Loop & Streams", "Middleware pipeline", "Error handling architecture", "Request validation & Zod/Pydantic"],
            recommendedProject: "Build a production-grade URL Shortener & Analytics API with custom aliases and click tracking.",
            estimatedWeeks: "3 Weeks"
          },
          {
            id: "be-2",
            title: "Relational Databases (PostgreSQL / MySQL)",
            description: "Design relational schemas, write complex joins, understand ACID transactions, indexing, and query execution plans.",
            requiredSkills: ["PostgreSQL", "SQL", "Database Design", "Indexing"],
            keyTopics: ["Normalization (1NF to 3NF)", "Indexes (B-Tree, GIN)", "Foreign keys & Cascade rules", "Transactions & Isolation Levels"],
            recommendedProject: "Design an E-commerce Order Management Schema with inventory locking and payment reconciliation.",
            estimatedWeeks: "4 Weeks"
          }
        ]
      },
      {
        phaseTitle: "Phase 2: Authentication, Security & NoSQL",
        items: [
          {
            id: "be-3",
            title: "Auth, JWTs, OAuth2 & Security Best Practices",
            description: "Implement secure user authentication, role-based access control (RBAC), bcrypt hashing, and rate limiting.",
            requiredSkills: ["Authentication", "JWT", "OAuth2", "Security"],
            keyTopics: ["Access & Refresh tokens", "Session vs Token Auth", "CSRF, XSS, and SQL Injection prevention", "Rate limiting"],
            recommendedProject: "Build a multi-tenant Authentication Service with email verification and Google OAuth2 login.",
            estimatedWeeks: "3 Weeks"
          },
          {
            id: "be-4",
            title: "NoSQL & Document Databases (MongoDB / Firestore)",
            description: "Understand unstructured data modeling, aggregation pipelines, document references, and sharding strategies.",
            requiredSkills: ["MongoDB", "Firestore", "NoSQL Modeling"],
            keyTopics: ["Embedding vs Referencing", "Aggregation Framework", "Compound Indexing", "Real-time subscriptions"],
            recommendedProject: "Build a Multi-room Real-time Chat Backend with message history and typing indicators.",
            estimatedWeeks: "3 Weeks"
          }
        ]
      },
      {
        phaseTitle: "Phase 3: Caching, Queues & Distributed Systems",
        items: [
          {
            id: "be-5",
            title: "In-Memory Caching with Redis",
            description: "Supercharge API response times using Redis as an in-memory cache, session store, and distributed lock.",
            requiredSkills: ["Redis", "Caching Strategies", "Pub/Sub"],
            keyTopics: ["Cache-aside pattern", "TTL & Eviction policies", "Redis Data types (Hashes, Sorted Sets)", "Pub/Sub & Queues"],
            recommendedProject: "Implement a Live Leaderboard and API Caching layer for an online quiz tournament API.",
            estimatedWeeks: "3 Weeks"
          },
          {
            id: "be-6",
            title: "Message Brokers (Kafka / RabbitMQ / BullMQ)",
            description: "Decouple heavy tasks from user requests using asynchronous queues and event-driven architecture.",
            requiredSkills: ["Message Queues", "BullMQ", "Event-Driven Architecture"],
            keyTopics: ["Producer-Consumer model", "Dead Letter Queues", "Idempotency", "Background PDF/Email processing"],
            recommendedProject: "Build a Background Video/Document Processing Service that sends push/email alerts when complete.",
            estimatedWeeks: "4 Weeks"
          }
        ]
      }
    ]
  },
  "aiml": {
    roleId: "aiml",
    roleTitle: "AI & Machine Learning Engineer",
    overview: "From foundational linear algebra and data preprocessing to deep learning, transformers, LLM prompt engineering, and RAG pipelines.",
    targetTimeline: "7 Months",
    phases: [
      {
        phaseTitle: "Phase 1: Mathematics, Python & Data Foundations",
        items: [
          {
            id: "ai-1",
            title: "Mathematics for ML: Linear Algebra & Calculus",
            description: "Vectors, matrices, eigenvalues, gradients, loss surfaces, and partial derivatives essential for understanding neural networks.",
            requiredSkills: ["Linear Algebra", "Calculus", "Probability & Statistics"],
            keyTopics: ["Matrix Multiplications", "Gradient Descent", "Normal Distributions & Bayes Theorem", "Cost Functions"],
            recommendedProject: "Implement Linear Regression and Logistic Regression from scratch using only pure Python and NumPy.",
            estimatedWeeks: "3 Weeks"
          },
          {
            id: "ai-2",
            title: "NumPy, Pandas & Exploratory Data Analysis (EDA)",
            description: "Clean, transform, and visualize complex datasets to extract statistical patterns.",
            requiredSkills: ["NumPy", "Pandas", "Matplotlib", "Seaborn"],
            keyTopics: ["Data imputation", "Feature Scaling & One-hot encoding", "Outlier detection", "Vectorized operations"],
            recommendedProject: "Perform comprehensive EDA on a Kaggle Student Placement or Housing dataset with insights report.",
            estimatedWeeks: "3 Weeks"
          }
        ]
      },
      {
        phaseTitle: "Phase 2: Classical Machine Learning & Deep Learning",
        items: [
          {
            id: "ai-3",
            title: "Scikit-Learn & Classical Supervised/Unsupervised ML",
            description: "Master Decision Trees, Random Forests, XGBoost, SVM, and Clustering algorithms.",
            requiredSkills: ["Scikit-Learn", "XGBoost", "Model Evaluation"],
            keyTopics: ["Cross-validation & Overfitting", "ROC-AUC, Precision, Recall", "Hyperparameter tuning", "Ensemble methods"],
            recommendedProject: "Build a Loan Default Prediction Model and evaluate feature importances using SHAP.",
            estimatedWeeks: "4 Weeks"
          },
          {
            id: "ai-4",
            title: "PyTorch & Deep Neural Networks",
            description: "Understand Tensors, Backpropagation, CNNs for computer vision, and RNNs/LSTMs for sequences.",
            requiredSkills: ["PyTorch", "Deep Learning", "Neural Networks"],
            keyTopics: ["Autograd engine", "Custom Datasets & DataLoaders", "Convolutional layers & Transfer Learning", "Loss functions"],
            recommendedProject: "Train a ResNet transfer learning model to classify skin diseases or plant leaves with >92% accuracy.",
            estimatedWeeks: "5 Weeks"
          }
        ]
      },
      {
        phaseTitle: "Phase 3: LLMs, Prompt Engineering, RAG & MLOps",
        items: [
          {
            id: "ai-5",
            title: "Transformers & Attention Mechanism",
            description: "Understand Self-Attention, Multi-Head Attention, Encoder-Decoder architectures, and Hugging Face pipelines.",
            requiredSkills: ["Transformers", "Hugging Face", "Tokenization"],
            keyTopics: ["Attention is All You Need architecture", "BERT vs GPT", "Tokenizers (BPE, WordPiece)", "Model Quantization"],
            recommendedProject: "Fine-tune a small open-source model (like Llama 3 8B or Mistral) for a specific domain QA task using LoRA.",
            estimatedWeeks: "4 Weeks"
          },
          {
            id: "ai-6",
            title: "Retrieval-Augmented Generation (RAG) & Vector DBs",
            description: "Build production AI agents that query private documents using Embeddings, Vector Databases, and LangChain/LlamaIndex.",
            requiredSkills: ["RAG", "Vector DB (Pinecone/Chroma)", "LangChain", "Embeddings"],
            keyTopics: ["Chunking strategies", "Cosine similarity", "Hybrid search (BM25 + Dense)", "Guardrails & Hallucination mitigation"],
            recommendedProject: "Build a Chat with Any Research Paper application with citation highlighting and hallucination checks.",
            estimatedWeeks: "4 Weeks"
          }
        ]
      }
    ]
  },
  "devops": {
    roleId: "devops",
    roleTitle: "DevOps & Cloud Engineer",
    overview: "Master Linux systems, containerization with Docker, Kubernetes orchestration, CI/CD pipelines, and Infrastructure as Code (Terraform).",
    targetTimeline: "6 Months",
    phases: [
      {
        phaseTitle: "Phase 1: Linux, Shell Scripting & Networking",
        items: [
          {
            id: "do-1",
            title: "Linux Operating System & Bash Scripting",
            description: "File permissions, systemd services, SSH keys, process management, and automating server setups.",
            requiredSkills: ["Linux", "Bash", "SSH", "System Administration"],
            keyTopics: ["Permissions & Sudo", "Systemd service daemons", "Bash loops & cron jobs", "Log monitoring with journalctl"],
            recommendedProject: "Write an automated Bash backup script that snapshots database files and rotates archives.",
            estimatedWeeks: "3 Weeks"
          },
          {
            id: "do-2",
            title: "Computer Networking & Web Servers",
            description: "DNS, TCP/IP, OSI model, SSL/TLS certificates, reverse proxies with Nginx, and HTTP status codes.",
            requiredSkills: ["Networking", "Nginx", "SSL/TLS", "DNS"],
            keyTopics: ["Reverse Proxy & Load Balancing", "Certbot & Let's Encrypt SSL", "Subnetting & CIDR basics", "HTTP/2 & WebSockets"],
            recommendedProject: "Configure an Nginx reverse proxy with SSL termination and rate limiting for a multi-service web app.",
            estimatedWeeks: "3 Weeks"
          }
        ]
      },
      {
        phaseTitle: "Phase 2: Docker, Containers & CI/CD",
        items: [
          {
            id: "do-3",
            title: "Docker & Containerization Mastery",
            description: "Write multi-stage Dockerfiles, minimize image sizes, manage Docker volumes, and compose multi-container apps.",
            requiredSkills: ["Docker", "Docker Compose", "Multi-stage Builds"],
            keyTopics: ["Image layers caching", "Docker network bridges", "Volume persistence", "Security: Non-root containers"],
            recommendedProject: "Containerize a Fullstack Next.js + Node + Redis + PostgreSQL application using Docker Compose.",
            estimatedWeeks: "3 Weeks"
          },
          {
            id: "do-4",
            title: "CI/CD Pipelines (GitHub Actions / GitLab CI)",
            description: "Automate testing, linting, building Docker images, and deploying to staging/production on every pull request.",
            requiredSkills: ["GitHub Actions", "CI/CD", "Automated Deployments"],
            keyTopics: ["Workflow triggers", "Secrets management", "Docker image tagging & publishing", "Zero-downtime deployments"],
            recommendedProject: "Set up a complete CI/CD pipeline that tests code, builds Docker images, and triggers deployment automatically.",
            estimatedWeeks: "3 Weeks"
          }
        ]
      },
      {
        phaseTitle: "Phase 3: Kubernetes & Infrastructure as Code (IaC)",
        items: [
          {
            id: "do-5",
            title: "Kubernetes (K8s) Orchestration",
            description: "Pods, Deployments, Services, Ingress controllers, ConfigMaps, Secrets, and Helm charts for enterprise deployments.",
            requiredSkills: ["Kubernetes", "Helm", "Cluster Management"],
            keyTopics: ["Self-healing deployments", "Horizontal Pod Autoscaling (HPA)", "Ingress routing", "Helm packaging"],
            recommendedProject: "Deploy a high-availability microservice cluster on local Minikube/Kind with Helm and HPA autoscaling.",
            estimatedWeeks: "5 Weeks"
          },
          {
            id: "do-6",
            title: "Terraform & AWS Cloud Basics",
            description: "Provision cloud infrastructure programmatically using Terraform (EC2, S3, RDS, VPC).",
            requiredSkills: ["Terraform", "AWS", "Infrastructure as Code"],
            keyTopics: ["Terraform state management", "VPC & Security Groups", "S3 & IAM policies", "Drift detection"],
            recommendedProject: "Provision a secure AWS VPC with public and private subnets, an EC2 web instance, and an RDS database via Terraform.",
            estimatedWeeks: "4 Weeks"
          }
        ]
      }
    ]
  },
  "cybersecurity": {
    roleId: "cybersecurity",
    roleTitle: "Cybersecurity Analyst & Pentester",
    overview: "Explore network security, ethical hacking, OWASP Top 10 vulnerabilities, cryptography, and defensive incident response.",
    targetTimeline: "6 Months",
    phases: [
      {
        phaseTitle: "Phase 1: Networking & Security Fundamentals",
        items: [
          {
            id: "sec-1",
            title: "Network Security & Packet Analysis (Wireshark)",
            description: "Understand TCP/IP 3-way handshakes, ARP spoofing, Wireshark packet inspection, and firewall rules.",
            requiredSkills: ["Networking", "Wireshark", "Nmap", "Firewalls"],
            keyTopics: ["Packet sniffing", "Port scanning with Nmap", "VLANs & VPNs", "IDS/IPS systems"],
            recommendedProject: "Perform a security audit of your local network: scan open ports, identify running services, and map vulnerabilities.",
            estimatedWeeks: "3 Weeks"
          },
          {
            id: "sec-2",
            title: "Cryptography & Public Key Infrastructure (PKI)",
            description: "Symmetric vs Asymmetric encryption (AES, RSA), hashing algorithms (SHA-256), and digital signatures.",
            requiredSkills: ["Cryptography", "PKI", "Hashing", "SSL/TLS"],
            keyTopics: ["Diffie-Hellman key exchange", "Salting & Rainbow table defenses", "Certificate Authorities", "PGP keys"],
            recommendedProject: "Build a secure end-to-end encrypted messaging script using Python cryptography libraries.",
            estimatedWeeks: "3 Weeks"
          }
        ]
      },
      {
        phaseTitle: "Phase 2: Web Application Security (OWASP Top 10)",
        items: [
          {
            id: "sec-3",
            title: "OWASP Top 10 Vulnerabilities & Burp Suite",
            description: "Identify and exploit SQL Injection (SQLi), Cross-Site Scripting (XSS), CSRF, IDOR, and Broken Access Control.",
            requiredSkills: ["Web Security", "OWASP Top 10", "Burp Suite"],
            keyTopics: ["Intercepting HTTP traffic with Burp", "Stored vs Reflected XSS", "SQLMap & manual SQLi", "IDOR exploitation"],
            recommendedProject: "Solve all beginner-to-intermediate labs on PortSwigger Web Security Academy for SQLi and XSS.",
            estimatedWeeks: "5 Weeks"
          },
          {
            id: "sec-4",
            title: "Linux Privilege Escalation & Ethical Hacking",
            description: "Enumerate system misconfigurations, SUID binaries, kernel exploits, and vulnerable cron jobs.",
            requiredSkills: ["Linux Security", "Privilege Escalation", "Metasploit"],
            keyTopics: ["SUID & Capabilities", "Sudo misconfigurations", "LinPEAS automated enumeration", "Reverse shells"],
            recommendedProject: "Root 5 distinct 'Easy' rated machines on TryHackMe or HackTheBox and write comprehensive vulnerability reports.",
            estimatedWeeks: "5 Weeks"
          }
        ]
      }
    ]
  }
};
