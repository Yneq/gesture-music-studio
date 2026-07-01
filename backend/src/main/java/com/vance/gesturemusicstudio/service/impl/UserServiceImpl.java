package com.vance.gesturemusicstudio.service.impl;

import com.vance.gesturemusicstudio.dao.UserDao;
import com.vance.gesturemusicstudio.dto.auth.RegisterRequest;
import com.vance.gesturemusicstudio.model.User;
import com.vance.gesturemusicstudio.exception.ApiException;
import com.vance.gesturemusicstudio.service.UserService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class UserServiceImpl implements UserService {

    private final UserDao userDao;
    private final PasswordEncoder passwordEncoder;

    @Override
    @Transactional
    public User register(RegisterRequest request) {
        if (userDao.existsByUsername(request.getUsername())) {
            throw new ApiException(HttpStatus.CONFLICT, "使用者名稱已被使用");
        }

        if (request.getEmail() != null && !request.getEmail().isBlank()
                && userDao.existsByEmail(request.getEmail())) {
            throw new ApiException(HttpStatus.CONFLICT, "Email 已被使用");
        }

        User user = User.builder()
                .username(request.getUsername())
                .password(passwordEncoder.encode(request.getPassword()))
                .email(request.getEmail())
                .build();

        return userDao.save(user);
    }

    @Override
    public User getById(Long id) {
        return userDao.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "找不到使用者"));
    }

    @Override
    public boolean existsByUsername(String username) {
        return userDao.existsByUsername(username);
    }
}
