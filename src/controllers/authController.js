/* eslint-disable no-unused-expressions */
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const mailer = require('../modules/mailes');

const authConfig = require('../config/auth');

const User = mongoose.model('User');

module.exports = {
  async store(req, res) {
    const { nome, email, password } = req.body;

    try {
      if (await User.findOne({ email }))
        return res.status(400).send({ error: 'User already exists' });

      // Só aceita os campos do cadastro, para ninguém gravar hash ou token pelo corpo da requisição.
      const user = await User.create({ nome, email, password });

      user.passwordHash = undefined;

      return res.json(user);
    } catch (err) {
      return res.status(400).send({ error: 'Register failed' });
    }
  },
  async login(req, res) {
    const { email, password } = req.body;

    const user = await User.findOne({ email });

    if (!user) return res.status(400).send({ error: 'User not found' });

    if (!(await bcrypt.compare(password, user.passwordHash)))
      return res.status(401).send({ error: 'Wrong password' });

    user.passwordHash = undefined;

    const token = jwt.sign({ id: user.id }, authConfig.secret, {
      expiresIn: 86400,
    });

    return res.send({ user, token });
  },
  async recuperedpass(req, res) {
    const { email } = req.body;

    try {
      const user = await User.findOne({ email });

      if (!user) return res.status(400).send({ error: 'User not found' });

      const token = crypto.randomBytes(20).toString('hex');

      const now = new Date();
      now.setHours(now.getHours() + 1);

      await User.findByIdAndUpdate(user.id, {
        $set: {
          passwordResetToken: token,
          passwordResetExpires: now,
        },
      });

      mailer.sendMail(
        {
          from: '',
          to: email,
          template: 'auth/forgot_password',
          context: { token },
        },
        (err) => {
          if (err)
            return res
              .status(400)
              .send({ error: 'Cannot send forgot password email' });

          return res.send();
        }
      );
    } catch (err) {
      res.status(400).send({ error: 'Erro on forgot password, try again' });
    }
  },
  async newpass(req, res) {
    const { email, token, password } = req.body;

    try {
      const user = await User.findOne({ email }).select(
        '+passwordResetToken +passwordResetExpires'
      );

      if (!user) return res.status(400).send({ error: 'User not found' });

      if (!user.passwordResetToken || token !== user.passwordResetToken)
        return res.status(400).send({ error: 'Token invalid' });

      const now = new Date();

      if (now > user.passwordResetExpires)
        return res
          .status(400)
          .send({ error: 'Token expired, generate a new one' });

      user.passwordHash = await bcrypt.hash(password, 10);

      // O token vale para uma única troca de senha.
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;

      await user.save();

      res.send();
    } catch (error) {
      res.status(400).send({ error: 'Cannot reset password, try again' });
    }
  },
};
