"""Modular intent-classification skills package.

Importing this package triggers auto-registration of all intent skills and the
analysis text-generation skill with the global ``SkillRegistry`` singleton.

To add a new intent skill:
1. Create ``skills/new_intent.py`` with a ``NewIntentSkill(IntentSkill)`` class
   and a module-level instance.
2. Import that instance here and call ``registry.register(...)``.
3. That's it — the orchestrator picks it up automatically.
"""

from skills.base import registry
from skills.asin import asin_skill
from skills.merchant import merchant_skill
from skills.payment import payment_skill
from skills.recommendation import recommendation_skill
from skills.tier import tier_skill
from skills.category import category_skill
from skills.analysis import analysis_intent_skill
from skills.analysis_text import analysis_text_skill

# Register all intent-classification skills.
registry.register(asin_skill)
registry.register(merchant_skill)
registry.register(payment_skill)
registry.register(recommendation_skill)
registry.register(tier_skill)
registry.register(category_skill)
registry.register(analysis_intent_skill)

# Register the analysis text-generation skill.
registry.register_analysis(analysis_text_skill)
