from .dependency import Dependency
from .user import User, Role, FormationProgram
from .item import Item, Category, Location, Status, Supplier
from .loan import Loan, LoanDetail
from .reservation import Reservation
from .maintenance import Maintenance
from .audit_log import AuditLog
from .token import RefreshToken, PasswordResetToken
from .movement import Movement, Notification
from .ticket import Ticket
from .chat_message import TicketMessage, StaffMessage
from .item_output import ItemOutput, OutputType, OutputStatus
from .ai_knowledge import AILearnedResponse
from .spare_part import SparePartRequest
from .assistant_thread import AssistantThread
from .user_preference import UserPreference, EmailChangeToken
